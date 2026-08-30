import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { arePreseasonGamesVisible, gamesForNextMatchday } from './src/gameFilters';
import { configurePwa } from './src/pwa';
import { isTipOpen } from './src/scoring';
import { isBackendConfigured, supabase } from './src/supabase';
import type { Game, LeaderboardEntry, RecentPrediction, Season, Team } from './src/types';

type Tab = 'spiele' | 'verlauf' | 'tabelle' | 'rangliste' | 'profil';

const demoSeason: Season = { id: 'demo', name: 'Oberliga Süd 2026/27', tablePredictionDeadline: '2026-09-17T21:59:59.000Z', status: 'upcoming' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configurePwa();
    if (!isBackendConfigured) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <ScreenLoader />;
  if (!session && isBackendConfigured) return <AuthScreen />;
  return <MainApp session={session} />;
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || password.length < 8 || (mode === 'register' && !name.trim())) {
      Alert.alert('Eingaben prüfen', 'Bitte gib eine E-Mail, einen Namen und mindestens 8 Zeichen als Passwort ein.'); return;
    }
    setBusy(true);
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() } } });
    setBusy(false);
    if (result.error) Alert.alert('Anmeldung fehlgeschlagen', result.error.message);
    else if (mode === 'register' && !result.data.session) Alert.alert('Fast geschafft', 'Bitte bestätige deine E-Mail-Adresse.');
  }

  return <SafeAreaView style={styles.safe}><View style={styles.authWrap}>
    <Text style={styles.brand}>POWERPLAY</Text><Text style={styles.authTitle}>Oberliga Tippspiel</Text>
    <Text style={styles.muted}>Tippe jedes Spiel. Beweise dein Tabellengefühl.</Text>
    {mode === 'register' && <Field label="Anzeigename" value={name} onChangeText={setName} />}
    <Field label="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Passwort" value={password} onChangeText={setPassword} secureTextEntry />
    <Button label={busy ? 'Bitte warten …' : mode === 'login' ? 'Einloggen' : 'Konto erstellen'} onPress={submit} disabled={busy} />
    <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}><Text style={styles.link}>{mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon registriert? Einloggen'}</Text></Pressable>
    {Platform.OS === 'web' && <View style={styles.legalLinks}><Pressable onPress={() => openLegalPage('/datenschutz.html')}><Text style={styles.legalLink}>Datenschutz</Text></Pressable><Text style={styles.muted}>·</Text><Pressable onPress={() => openLegalPage('/impressum.html')}><Text style={styles.legalLink}>Impressum</Text></Pressable></View>}
  </View></SafeAreaView>;
}

function MainApp({ session }: { session: Session | null }) {
  const [tab, setTab] = useState<Tab>('spiele');
  const [games, setGames] = useState<Game[]>([]);
  const [season, setSeason] = useState<Season>(demoSeason);
  const [teams, setTeams] = useState<Team[]>([]);
  const [gameRanking, setGameRanking] = useState<LeaderboardEntry[]>([]);
  const [tableRanking, setTableRanking] = useState<LeaderboardEntry[]>([]);
  const [recentPredictions, setRecentPredictions] = useState<RecentPrediction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const gamesRef = useRef<Game[]>([]);
  const liveSyncRunning = useRef(false);

  const load = useCallback(async (showSpinner = true) => {
    if (!session) return;
    if (showSpinner) setRefreshing(true);
    const [{ data: seasonRows }, { data: gameRows }, { data: gameRanks }, { data: tableRanks }, { data: recentRows }] = await Promise.all([
      supabase.from('seasons').select('*').order('created_at', { ascending: false }).limit(1),
      supabase.from('games_with_my_predictions').select('*').order('starts_at'),
      supabase.rpc('game_leaderboard'), supabase.rpc('table_leaderboard'),
      supabase.rpc('recent_game_predictions'),
    ]);
    const current = seasonRows?.[0];
    if (current) setSeason({ id: current.id, name: current.name, tablePredictionDeadline: current.table_prediction_deadline, status: current.status });
    if (gameRanks) setGameRanking(gameRanks.map(mapRank));
    if (tableRanks) setTableRanking(tableRanks.map(mapRank));
    if (recentRows) setRecentPredictions(recentRows.map(mapRecentPrediction));
    const { data: teamRows } = current ? await supabase.from('teams').select('*').eq('season_id', current.id).order('name') : { data: null };
    const teamsById = new Map<string, Team>();
    if (teamRows?.length) {
      const mapped: Team[] = teamRows.map(t => ({ id: t.id, name: t.name, shortName: t.short_name, logoUrl: t.logo_url, isCompetitor: t.is_competitor !== false }));
      mapped.forEach(team => teamsById.set(team.id, team));
      const competitors = mapped.filter(team => team.isCompetitor !== false);
      const { data: savedOrder } = await supabase.from('table_predictions').select('team_id,predicted_position').eq('season_id', current.id).order('predicted_position');
      const byId = new Map(competitors.map(team => [team.id, team]));
      const ordered = (savedOrder ?? []).flatMap(item => {
        const team = byId.get(item.team_id);
        return team ? [team] : [];
      });
      setTeams(ordered?.length === competitors.length ? ordered : competitors);
    }
    setGames((gameRows ?? []).map(row => mapGame(row, teamsById)));
    setRefreshing(false);
  }, [session]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { gamesRef.current = games; }, [games]);
  useEffect(() => {
    if (!session) return;
    const refreshLiveScores = async (force = false) => {
      const now = Date.now();
      const potentialLiveGame = gamesRef.current.some(game => {
        const start = new Date(game.startsAt).getTime();
        return !game.isFinal && start <= now + 10 * 60_000 && start >= now - 5 * 60 * 60_000;
      });
      if ((!force && !potentialLiveGame) || liveSyncRunning.current) return;
      liveSyncRunning.current = true;
      try {
        const { error } = await supabase.functions.invoke('sync-deb');
        if (!error) await load(false);
      } finally {
        liveSyncRunning.current = false;
      }
    };
    refreshLiveScores(true);
    const timer = setInterval(() => refreshLiveScores(), 60_000);
    return () => clearInterval(timer);
  }, [load, session]);

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    {!isBackendConfigured && <View style={styles.demoBanner}><Text style={styles.demoText}>DEMO · Backend noch nicht verbunden</Text></View>}
    <View style={styles.header}><View><Text style={styles.kicker}>{season.name}</Text><Text style={styles.title}>{titleFor(tab)}</Text></View><View style={styles.puck}><Text>🏒</Text></View></View>
    <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} refreshControl={undefined}>
      {refreshing ? <ActivityIndicator color="#b8f341" /> : null}
      {tab === 'spiele' && <GamesScreen games={games} setGames={setGames} session={session} />}
      {tab === 'verlauf' && <TipsHistoryScreen predictions={recentPredictions} />}
      {tab === 'tabelle' && <TableTipScreen season={season} teams={teams} session={session} />}
      {tab === 'rangliste' && <RankingScreen games={gameRanking} table={tableRanking} season={season} />}
      {tab === 'profil' && <ProfileScreen session={session} onRefresh={load} />}
    </ScrollView>
    <View style={styles.nav}>{(['spiele', 'verlauf', 'tabelle', 'rangliste', 'profil'] as Tab[]).map(item => <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}><Text style={[styles.navIcon, tab === item && styles.active]}>{({ spiele: '◫', verlauf: '◷', tabelle: '≡', rangliste: '♛', profil: '●' } as const)[item]}</Text><Text style={[styles.navLabel, tab === item && styles.active]}>{item[0]!.toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function GamesScreen({ games, setGames, session }: { games: Game[]; setGames: Dispatch<SetStateAction<Game[]>>; session: Session | null }) {
  const [phase, setPhase] = useState<Game['phase']>('regular');
  const [scope, setScope] = useState<'next' | 'all'>('next');
  const preseasonVisible = arePreseasonGamesVisible(games);
  const phases: Game['phase'][] = preseasonVisible ? ['regular', 'preseason', 'playoffs'] : ['regular', 'playoffs'];
  useEffect(() => {
    if (phase === 'preseason' && !preseasonVisible) setPhase('regular');
  }, [phase, preseasonVisible]);
  const phaseGames = games.filter(game => game.phase === phase);
  const shown = scope === 'next' ? gamesForNextMatchday(phaseGames) : phaseGames;
  const shownMatchday = scope === 'next' ? shown[0]?.matchday : null;
  const save = useCallback(async (game: Game, home: string, away: string): Promise<boolean> => {
    const h = Number(home), a = Number(away);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) return false;
    if (!isTipOpen(game.startsAt)) { Alert.alert('Tipp geschlossen', 'Das Spiel hat bereits begonnen.'); return false; }
    if (session) {
      const { error } = await supabase.rpc('save_game_prediction', { p_game_id: game.id, p_home: h, p_away: a });
      if (error) { Alert.alert('Nicht gespeichert', error.message); return false; }
    }
    setGames(current => current.map(item => item.id === game.id ? { ...item, predictedHome: h, predictedAway: a } : item));
    return true;
  }, [session, setGames]);
  const nextPhase = () => setPhase(current => phases[(phases.indexOf(current) + 1) % phases.length] ?? 'regular');
  const phaseLabel = phase === 'regular' ? 'Hauptrunde' : phase === 'preseason' ? 'Testspiele' : 'Playoffs';
  return <>
    <View style={styles.filterRow}>
      <FilterButton label="Phase" value={phaseLabel} onPress={nextPhase} />
      <FilterButton label="Anzeige" value={scope === 'next' ? 'Nächster Spieltag' : 'Alle Spiele'} onPress={() => setScope(current => current === 'next' ? 'all' : 'next')} />
    </View>
    <Text style={styles.sectionHint}>{phase === 'preseason' ? 'Testspiele dienen nur zum Ausprobieren und zählen nicht für die Rangliste. ' : ''}{scope === 'next' ? shownMatchday ? `Kompletter ${shownMatchday}. Spieltag. ` : 'Alle Spiele des nächsten anstehenden Spieltags. ' : ''}Tipps bleiben bis zum offiziellen Spielbeginn änderbar.</Text>
    {shown.map(game => <GameCard key={game.id} game={game} onSave={save} />)}
    {!shown.length && <Empty text={scope === 'next' ? 'Kein weiterer Spieltag in dieser Phase.' : 'Noch keine Spiele in dieser Phase.'} />}
  </>;
}

function GameCard({ game, onSave }: { game: Game; onSave: (g: Game, h: string, a: string) => Promise<boolean> }) {
  const [home, setHome] = useState(game.predictedHome?.toString() ?? '');
  const [away, setAway] = useState(game.predictedAway?.toString() ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>(game.predictedHome === null ? 'idle' : 'saved');
  const lastSaved = useRef(game.predictedHome === null || game.predictedAway === null ? '' : `${game.predictedHome}:${game.predictedAway}`);
  const open = isTipOpen(game.startsAt);
  useEffect(() => {
    if (!open || !/^\d{1,2}$/.test(home) || !/^\d{1,2}$/.test(away) || Number(home) > 30 || Number(away) > 30) {
      setSaveState('idle');
      return;
    }
    const value = `${Number(home)}:${Number(away)}`;
    if (value === lastSaved.current) { setSaveState('saved'); return; }
    setSaveState('pending');
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSaveState('saving');
      const previousValue = lastSaved.current;
      lastSaved.current = value;
      const saved = await onSave(game, home, away);
      if (!saved) lastSaved.current = previousValue;
      if (cancelled) return;
      if (saved) setSaveState('saved');
      else setSaveState('error');
    }, 700);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [away, game, home, onSave, open]);
  const date = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(game.startsAt));
  const gameState = game.isLive ? 'LIVE' : open ? 'OFFEN' : game.isFinal ? 'BEENDET' : 'GESCHLOSSEN';
  return <View style={styles.card}>
    <View style={styles.cardTop}><Text style={styles.date}>{date} Uhr</Text><Text style={[styles.state, !open && styles.closed, game.isLive && styles.live]}>{gameState}</Text></View>
    <View style={styles.matchRow}><TeamBlock team={game.homeTeam} /><View style={styles.scoreInputs}><ScoreInput value={home} onChange={setHome} disabled={!open} /><Text style={styles.colon}>:</Text><ScoreInput value={away} onChange={setAway} disabled={!open} /></View><TeamBlock team={game.awayTeam} /></View>
    {game.homeScore !== null && <Text style={[styles.result, game.isLive && styles.liveText]}>{game.isLive ? 'Live' : 'Endstand'} {game.homeScore}:{game.awayScore}{game.isFinal ? game.phase === 'preseason' ? ' · ohne Wertung' : ` · ${game.points ?? 0} Punkte` : ''}</Text>}
    {open && saveState !== 'idle' && <Text style={[styles.saveStatus, saveState === 'error' && styles.saveError]}>{saveState === 'saved' ? '✓ Gespeichert' : saveState === 'error' ? 'Nicht gespeichert' : saveState === 'saving' ? 'Speichert …' : 'Wird gespeichert …'}</Text>}
  </View>;
}

function TipsHistoryScreen({ predictions }: { predictions: RecentPrediction[] }) {
  const games = new Map<string, { game: RecentPrediction; tips: RecentPrediction[] }>();
  for (const prediction of predictions) {
    const entry = games.get(prediction.gameId) ?? { game: prediction, tips: [] };
    entry.tips.push(prediction);
    games.set(prediction.gameId, entry);
  }
  return <>
    <Text style={styles.sectionHint}>Hier siehst du die Tipps aller Mitspieler aus den letzten 14 Tagen. Sie werden erst nach dem jeweiligen Spielbeginn sichtbar.</Text>
    {[...games.values()].map(({ game, tips }) => {
      const date = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(game.startsAt));
      return <View key={game.gameId} style={styles.card}>
        <View style={styles.cardTop}><Text style={styles.date}>{date} Uhr</Text><Text style={[styles.state, styles.closed, game.isLive && styles.live]}>{game.isLive ? 'LIVE' : game.isFinal ? 'BEENDET' : 'GESTARTET'}</Text></View>
        <View style={styles.historyMatch}>
          <View style={styles.historyTeam}><TeamLogo team={game.homeTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.homeTeam.name}</Text></View>
          <Text style={[styles.historyScore, game.isLive && styles.liveText]}>{game.homeScore === null ? '– : –' : `${game.homeScore} : ${game.awayScore}`}</Text>
          <View style={styles.historyTeam}><TeamLogo team={game.awayTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.awayTeam.name}</Text></View>
        </View>
        <View style={styles.tipList}>{tips.map((tip, index) => <View key={`${tip.gameId}-${tip.displayName}-${index}`} style={styles.tipRow}><Text style={styles.tipName}>{tip.displayName}</Text><Text style={styles.tipValue}>{tip.predictedHome}:{tip.predictedAway}</Text>{game.isFinal && tip.points !== null && <Text style={styles.tipPoints}>{tip.points} P</Text>}</View>)}</View>
      </View>;
    })}
    {!games.size && <Empty text="In den letzten 14 Tagen gibt es noch keine sichtbaren Tipps." />}
  </>;
}

function TableTipScreen({ season, teams, session }: { season: Season; teams: Team[]; session: Session | null }) {
  const [ordered, setOrdered] = useState(teams);
  const open = new Date() < new Date(season.tablePredictionDeadline);
  useEffect(() => setOrdered(teams), [teams]);
  function move(index: number, delta: number) { const next = [...ordered]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; setOrdered(next); }
  async function save() {
    if (!open) return;
    if (session) { const { error } = await supabase.rpc('save_table_prediction', { p_season_id: season.id, p_team_ids: ordered.map(t => t.id) }); if (error) { Alert.alert('Nicht gespeichert', error.message); return; } }
    Alert.alert('Tabellentipp gespeichert', 'Du kannst ihn bis zur Deadline weiter ändern.');
  }
  const deadline = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(season.tablePredictionDeadline));
  return <><View style={styles.deadline}><Text style={styles.deadlineLabel}>{open ? 'ABGABE BIS' : 'ABGABE BEENDET'}</Text><Text style={styles.deadlineValue}>{deadline} Uhr</Text></View><Text style={styles.sectionHint}>Sortiere alle Teams auf ihre erwartete Abschlussposition. Pro Team gibt es bei {teams.length} Teams maximal {teams.length} Punkte; jeder Platz Abweichung kostet einen Punkt.</Text>
    {ordered.map((team, i) => <View key={team.id} style={styles.teamRank}><Text style={styles.rankNo}>{i + 1}</Text><TeamLogo team={team} /><Text style={styles.teamName}>{team.name}</Text>{open && <View style={styles.arrows}><Pressable onPress={() => move(i, -1)}><Text style={styles.arrow}>↑</Text></Pressable><Pressable onPress={() => move(i, 1)}><Text style={styles.arrow}>↓</Text></Pressable></View>}</View>)}
    {open && <Button label="Tabellentipp speichern" onPress={save} />}
  </>;
}

function RankingScreen({ games, table, season }: { games: LeaderboardEntry[]; table: LeaderboardEntry[]; season: Season }) {
  const [type, setType] = useState<'games' | 'table'>('games');
  const entries = type === 'games' ? games : table;
  return <><Segment options={[['games', 'Spielt Tipps'], ['table', 'Tabellentipps']]} value={type} onChange={setType} /><Text style={styles.sectionHint}>{type === 'games' ? '3 Punkte exakt · 2 Tordifferenz · 1 Sieger' : season.status === 'finished' ? 'Auswertung der Abschlusspositionen' : 'Wird nach Ende der Hauptrunde veröffentlicht.'}</Text>
    {entries.map(entry => <View key={`${entry.rank}-${entry.displayName}`} style={styles.rankingRow}><Text style={[styles.rankNo, entry.rank <= 3 && styles.active]}>{entry.rank}</Text><Text style={styles.rankingName}>{entry.displayName}</Text>{entry.exactTips !== undefined && <Text style={styles.exacts}>{entry.exactTips} exakt</Text>}<Text style={styles.points}>{entry.points} P</Text></View>)}
    {!entries.length && <Empty text="Die Auswertung erscheint nach Ende der Hauptrunde." />}
  </>;
}

function ProfileScreen({ session, onRefresh }: { session: Session | null; onRefresh: () => void }) {
  return <>
    <View style={styles.card}><Text style={styles.cardTitle}>Mein Konto</Text><Text style={styles.muted}>{session?.user.email ?? 'Demo-Spieler'}</Text><View style={styles.spacer} /><Button label="Daten aktualisieren" onPress={onRefresh} />{session && <Pressable onPress={() => supabase.auth.signOut()}><Text style={styles.danger}>Abmelden</Text></Pressable>}</View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Impressum</Text>
      <Text style={styles.legalText}>Angaben gemäß § 5 DDG</Text>
      <Text style={styles.legalText}>Fabian Zwerger{`\n`}Angermoosstraße 25{`\n`}86971 Peiting</Text>
      <Text style={styles.legalHeading}>Kontakt</Text>
      <Text style={styles.legalText}>E-Mail: fabian.zwerger@web.de</Text>
      {Platform.OS === 'web' && <View style={styles.legalLinks}><Pressable onPress={() => openLegalPage('/datenschutz.html')}><Text style={styles.legalLink}>Datenschutzerklärung öffnen</Text></Pressable></View>}
    </View>
  </>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string }) { return <View style={styles.fieldWrap}><Text style={styles.label}>{props.label}</Text><TextInput placeholderTextColor="#718096" style={styles.field} {...props} /></View>; }
function ScoreInput({ value, onChange, disabled }: { value: string; onChange: (s: string) => void; disabled: boolean }) { return <TextInput value={value} onChangeText={onChange} editable={!disabled} keyboardType="number-pad" maxLength={2} style={[styles.score, disabled && styles.scoreDisabled]} placeholder="–" placeholderTextColor="#536071" />; }
function TeamBlock({ team }: { team: Team }) { return <View style={styles.teamBlock}><TeamLogo team={team} large /><Text numberOfLines={2} style={styles.teamBlockName}>{team.name}</Text></View>; }
function TeamLogo({ team, large = false }: { team: Team; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [team.logoUrl]);
  const frameStyle = large ? styles.logoLarge : styles.logo;
  if (!team.logoUrl || failed) return <View style={[styles.badge, frameStyle]}><Text style={styles.badgeText}>{team.shortName.slice(0, 3)}</Text></View>;
  return <View style={[styles.logoFrame, frameStyle]}><Image source={{ uri: team.logoUrl }} resizeMode="contain" style={styles.logoImage} onError={() => setFailed(true)} accessibilityLabel={`Logo ${team.name}`} /></View>;
}
function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: .5 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function FilterButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.filterButton} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Zum Wechseln antippen.`}><Text style={styles.filterLabel}>{label}</Text><View style={styles.filterValueRow}><Text numberOfLines={1} style={styles.filterValue}>{value}</Text><Text style={styles.filterArrow}>↕</Text></View></Pressable>; }
function Segment<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) { return <View style={styles.segment}>{options.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.segmentItem, key === value && styles.segmentActive]}><Text style={[styles.segmentText, key === value && styles.segmentTextActive]}>{label}</Text></Pressable>)}</View>; }
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>; }
function ScreenLoader() { return <SafeAreaView style={styles.safe}><ActivityIndicator style={{ flex: 1 }} color="#b8f341" /></SafeAreaView>; }
function titleFor(tab: Tab) { return ({ spiele: 'Meine Tipps', verlauf: 'Tippverlauf', tabelle: 'Saisontabelle', rangliste: 'Ranglisten', profil: 'Profil' } as const)[tab]; }
function openLegalPage(path: string) { if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(path); }
function mapRank(row: any): LeaderboardEntry { return { rank: Number(row.rank), displayName: row.display_name, points: Number(row.points), exactTips: row.exact_tips === undefined ? undefined : Number(row.exact_tips) }; }
function mapGame(row: any, teamsById: Map<string, Team>): Game { return { id: row.id, phase: row.is_preseason ? 'preseason' : row.phase, matchday: row.matchday ?? null, startsAt: row.starts_at, homeTeam: teamsById.get(row.home_team_id) ?? { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name }, awayTeam: teamsById.get(row.away_team_id) ?? { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name }, homeScore: row.home_score, awayScore: row.away_score, isLive: row.is_live ?? false, isFinal: row.is_final ?? false, predictedHome: row.predicted_home, predictedAway: row.predicted_away, points: row.prediction_points }; }
function mapRecentPrediction(row: any): RecentPrediction { return { gameId: row.game_id, startsAt: row.starts_at, homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logoUrl: row.home_team_logo_url }, awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logoUrl: row.away_team_logo_url }, homeScore: row.home_score, awayScore: row.away_score, isLive: row.is_live ?? false, isFinal: row.is_final ?? false, displayName: row.display_name, predictedHome: row.predicted_home, predictedAway: row.predicted_away, points: row.points }; }

const c = { bg: '#071426', panel: '#0d2038', panel2: '#122a48', ink: '#f4f8fc', muted: '#8fa3b9', lime: '#b8f341', blue: '#2f80ed', red: '#ff6b6b', line: '#203a58' };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, content: { flex: 1 }, contentInner: { padding: 18, paddingBottom: 34 }, header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, kicker: { color: c.lime, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }, title: { color: c.ink, fontSize: 28, fontWeight: '900', marginTop: 3 }, puck: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.panel2, justifyContent: 'center', alignItems: 'center' }, demoBanner: { backgroundColor: c.lime, paddingVertical: 7, alignItems: 'center' }, demoText: { color: c.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1 }, nav: { borderTopWidth: 1, borderTopColor: c.line, backgroundColor: '#09182a', flexDirection: 'row', paddingTop: 8, paddingBottom: 10 }, navItem: { flex: 1, alignItems: 'center', gap: 3 }, navIcon: { color: c.muted, fontSize: 19 }, navLabel: { color: c.muted, fontSize: 9, fontWeight: '700' }, active: { color: c.lime }, filterRow: { flexDirection: 'row', gap: 10, marginBottom: 13 }, filterButton: { flex: 1, minWidth: 0, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 }, filterLabel: { color: c.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }, filterValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, filterValue: { color: c.ink, fontSize: 13, fontWeight: '800', flexShrink: 1 }, filterArrow: { color: c.lime, fontSize: 15, fontWeight: '900' }, segment: { padding: 4, borderRadius: 12, backgroundColor: c.panel, flexDirection: 'row', marginBottom: 14 }, segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' }, segmentActive: { backgroundColor: c.lime }, segmentText: { color: c.muted, fontWeight: '800' }, segmentTextActive: { color: c.bg }, sectionHint: { color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: 15 }, card: { borderRadius: 16, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 16, marginBottom: 13 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }, date: { color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }, state: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, closed: { color: c.red }, live: { color: '#ff3b30' }, liveText: { color: '#ff5a52' }, matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, teamBlock: { width: '28%', alignItems: 'center' }, teamBlockName: { color: c.ink, textAlign: 'center', fontSize: 12, fontWeight: '700', marginTop: 8 }, logoFrame: { backgroundColor: '#f4f8fc', borderWidth: 1, borderColor: '#315274', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, logo: { width: 42, height: 42, borderRadius: 12 }, logoLarge: { width: 58, height: 58, borderRadius: 14 }, logoImage: { width: '86%', height: '86%' }, badge: { minWidth: 42, height: 42, borderRadius: 12, backgroundColor: c.panel2, borderWidth: 1, borderColor: '#315274', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, badgeText: { color: c.ink, fontWeight: '900', fontSize: 11 }, scoreInputs: { flexDirection: 'row', alignItems: 'center' }, score: { width: 48, height: 52, borderRadius: 10, backgroundColor: '#07182b', color: c.ink, fontSize: 24, fontWeight: '900', textAlign: 'center', borderWidth: 1, borderColor: '#315274' }, scoreDisabled: { color: c.muted }, colon: { color: c.muted, fontSize: 24, paddingHorizontal: 7 }, saveStatus: { color: c.lime, textAlign: 'center', marginTop: 10, fontSize: 11, fontWeight: '800' }, saveError: { color: c.red }, result: { color: c.lime, textAlign: 'center', marginTop: 14, fontWeight: '700' }, historyMatch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, historyTeam: { width: '34%', alignItems: 'center', gap: 6 }, historyTeamName: { color: c.ink, textAlign: 'center', fontSize: 11, fontWeight: '700' }, historyScore: { color: c.ink, fontSize: 22, fontWeight: '900' }, tipList: { borderTopWidth: 1, borderTopColor: c.line }, tipRow: { flexDirection: 'row', alignItems: 'center', minHeight: 38, borderBottomWidth: 1, borderBottomColor: c.line }, tipName: { color: c.ink, flex: 1, fontWeight: '700' }, tipValue: { color: c.ink, fontSize: 16, fontWeight: '900', minWidth: 48, textAlign: 'center' }, tipPoints: { color: c.lime, width: 42, textAlign: 'right', fontWeight: '900' }, button: { backgroundColor: c.lime, borderRadius: 11, paddingVertical: 14, alignItems: 'center', marginTop: 16 }, buttonText: { color: c.bg, fontWeight: '900' }, deadline: { backgroundColor: c.panel2, borderLeftWidth: 4, borderLeftColor: c.lime, borderRadius: 10, padding: 14, marginBottom: 13 }, deadlineLabel: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, deadlineValue: { color: c.ink, fontSize: 17, fontWeight: '800', marginTop: 3 }, teamRank: { flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 10 }, rankNo: { width: 25, color: c.muted, fontWeight: '900', textAlign: 'center' }, teamName: { color: c.ink, flex: 1, fontWeight: '700' }, arrows: { flexDirection: 'row', gap: 10 }, arrow: { color: c.lime, fontSize: 23, padding: 4 }, rankingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.panel, borderRadius: 12, padding: 14, marginBottom: 8 }, rankingName: { flex: 1, color: c.ink, fontWeight: '800' }, exacts: { color: c.muted, fontSize: 12, marginRight: 12 }, points: { color: c.lime, fontSize: 17, fontWeight: '900' }, empty: { padding: 40, alignItems: 'center' }, authWrap: { flex: 1, padding: 24, justifyContent: 'center' }, brand: { color: c.lime, fontSize: 13, fontWeight: '900', letterSpacing: 3 }, authTitle: { color: c.ink, fontSize: 34, fontWeight: '900', marginTop: 8, marginBottom: 8 }, muted: { color: c.muted, lineHeight: 20 }, fieldWrap: { marginTop: 18 }, label: { color: c.muted, fontSize: 12, fontWeight: '800', marginBottom: 7 }, field: { backgroundColor: c.panel, color: c.ink, borderRadius: 11, borderWidth: 1, borderColor: c.line, padding: 14, fontSize: 16 }, link: { color: c.lime, textAlign: 'center', padding: 18, fontWeight: '700' }, legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 6 }, legalLink: { color: c.lime, fontWeight: '700', paddingVertical: 8 }, cardTitle: { color: c.ink, fontSize: 20, fontWeight: '900', marginBottom: 5 }, spacer: { height: 15 }, danger: { color: c.red, textAlign: 'center', marginTop: 20, fontWeight: '800' }, legalHeading: { color: c.ink, fontWeight: '900', marginTop: 16, marginBottom: 5 }, legalText: { color: c.muted, lineHeight: 21, marginTop: 6 }
});
