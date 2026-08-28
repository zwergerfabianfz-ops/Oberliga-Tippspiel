import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { configurePwa } from './src/pwa';
import { isTipOpen } from './src/scoring';
import { isBackendConfigured, supabase } from './src/supabase';
import type { Game, LeaderboardEntry, Season, Team } from './src/types';

type Tab = 'spiele' | 'tabelle' | 'rangliste' | 'profil';

const demoTeamData: Array<[string, string, string]> = [
  ['deg', 'Deggendorfer SC', 'DSC'], ['heil', 'Heilbronner Falken', 'HEI'],
  ['mem', 'ECDC Memmingen', 'MEM'], ['toelz', 'Tölzer Löwen', 'TÖL'],
  ['haching', 'Höchstadt Alligators', 'HEC'], ['riesser', 'SC Riessersee', 'SCR'],
];
const demoTeams: Team[] = demoTeamData.map(([id, name, shortName]) => ({ id, name, shortName }));

const demoGames: Game[] = [
  { id: 'g1', phase: 'regular', startsAt: '2026-09-20T16:00:00.000Z', homeTeam: demoTeams[0]!, awayTeam: demoTeams[1]!, homeScore: null, awayScore: null, predictedHome: null, predictedAway: null, points: null },
  { id: 'g2', phase: 'regular', startsAt: '2026-09-20T16:30:00.000Z', homeTeam: demoTeams[2]!, awayTeam: demoTeams[3]!, homeScore: null, awayScore: null, predictedHome: 4, predictedAway: 2, points: null },
  { id: 'g3', phase: 'playoffs', startsAt: '2026-09-22T18:00:00.000Z', homeTeam: demoTeams[4]!, awayTeam: demoTeams[5]!, homeScore: null, awayScore: null, predictedHome: null, predictedAway: null, points: null },
];

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
  const [games, setGames] = useState<Game[]>(demoGames);
  const [season, setSeason] = useState<Season>(demoSeason);
  const [teams, setTeams] = useState<Team[]>(demoTeams);
  const [gameRanking, setGameRanking] = useState<LeaderboardEntry[]>([{ rank: 1, displayName: 'Eisfuchs', points: 42, exactTips: 8 }, { rank: 2, displayName: 'Powerplay', points: 38, exactTips: 7 }]);
  const [tableRanking, setTableRanking] = useState<LeaderboardEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!session) return;
    setRefreshing(true);
    const [{ data: seasonRows }, { data: gameRows }, { data: gameRanks }, { data: tableRanks }] = await Promise.all([
      supabase.from('seasons').select('*').order('created_at', { ascending: false }).limit(1),
      supabase.from('games_with_my_predictions').select('*').order('starts_at'),
      supabase.rpc('game_leaderboard'), supabase.rpc('table_leaderboard'),
    ]);
    const current = seasonRows?.[0];
    if (current) setSeason({ id: current.id, name: current.name, tablePredictionDeadline: current.table_prediction_deadline, status: current.status });
    if (gameRows?.length) setGames(gameRows.map(mapGame));
    if (gameRanks) setGameRanking(gameRanks.map(mapRank));
    if (tableRanks) setTableRanking(tableRanks.map(mapRank));
    const { data: teamRows } = current ? await supabase.from('teams').select('*').eq('season_id', current.id).order('name') : { data: null };
    if (teamRows?.length) {
      const mapped: Team[] = teamRows.map(t => ({ id: t.id, name: t.name, shortName: t.short_name, logoUrl: t.logo_url }));
      const { data: savedOrder } = await supabase.from('table_predictions').select('team_id,predicted_position').eq('season_id', current.id).order('predicted_position');
      const byId = new Map(mapped.map(team => [team.id, team]));
      const ordered = (savedOrder ?? []).flatMap(item => {
        const team = byId.get(item.team_id);
        return team ? [team] : [];
      });
      setTeams(ordered?.length === mapped.length ? ordered : mapped);
    }
    setRefreshing(false);
  }

  useEffect(() => { load(); }, [session]);

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="light" />
    {!isBackendConfigured && <View style={styles.demoBanner}><Text style={styles.demoText}>DEMO · Backend noch nicht verbunden</Text></View>}
    <View style={styles.header}><View><Text style={styles.kicker}>{season.name}</Text><Text style={styles.title}>{titleFor(tab)}</Text></View><View style={styles.puck}><Text>🏒</Text></View></View>
    <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} refreshControl={undefined}>
      {refreshing ? <ActivityIndicator color="#b8f341" /> : null}
      {tab === 'spiele' && <GamesScreen games={games} setGames={setGames} session={session} />}
      {tab === 'tabelle' && <TableTipScreen season={season} teams={teams} session={session} />}
      {tab === 'rangliste' && <RankingScreen games={gameRanking} table={tableRanking} season={season} />}
      {tab === 'profil' && <ProfileScreen session={session} onRefresh={load} />}
    </ScrollView>
    <View style={styles.nav}>{(['spiele', 'tabelle', 'rangliste', 'profil'] as Tab[]).map(item => <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}><Text style={[styles.navIcon, tab === item && styles.active]}>{({ spiele: '◫', tabelle: '≡', rangliste: '♛', profil: '●' } as const)[item]}</Text><Text style={[styles.navLabel, tab === item && styles.active]}>{item[0]!.toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function GamesScreen({ games, setGames, session }: { games: Game[]; setGames: (g: Game[]) => void; session: Session | null }) {
  const [phase, setPhase] = useState<'regular' | 'playoffs'>('regular');
  const shown = games.filter(g => g.phase === phase);
  async function save(game: Game, home: string, away: string) {
    const h = Number(home), a = Number(away);
    if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) { Alert.alert('Ungültiger Tipp', 'Bitte gib Tore zwischen 0 und 30 ein.'); return; }
    if (!isTipOpen(game.startsAt)) { Alert.alert('Tipp geschlossen', 'Das Spiel hat bereits begonnen.'); return; }
    if (session) {
      const { error } = await supabase.rpc('save_game_prediction', { p_game_id: game.id, p_home: h, p_away: a });
      if (error) { Alert.alert('Nicht gespeichert', error.message); return; }
    }
    setGames(games.map(item => item.id === game.id ? { ...item, predictedHome: h, predictedAway: a } : item));
  }
  return <>
    <Segment options={[['regular', 'Hauptrunde'], ['playoffs', 'Playoffs']]} value={phase} onChange={setPhase} />
    <Text style={styles.sectionHint}>Tipps bleiben bis zum offiziellen Spielbeginn änderbar.</Text>
    {shown.map(game => <GameCard key={game.id} game={game} onSave={save} />)}
    {!shown.length && <Empty text="Noch keine Spiele in dieser Phase." />}
  </>;
}

function GameCard({ game, onSave }: { game: Game; onSave: (g: Game, h: string, a: string) => void }) {
  const [home, setHome] = useState(game.predictedHome?.toString() ?? '');
  const [away, setAway] = useState(game.predictedAway?.toString() ?? '');
  const open = isTipOpen(game.startsAt);
  const date = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(game.startsAt));
  return <View style={styles.card}>
    <View style={styles.cardTop}><Text style={styles.date}>{date} Uhr</Text><Text style={[styles.state, !open && styles.closed]}>{open ? 'OFFEN' : 'GESCHLOSSEN'}</Text></View>
    <View style={styles.matchRow}><TeamBlock team={game.homeTeam} /><View style={styles.scoreInputs}><ScoreInput value={home} onChange={setHome} disabled={!open} /><Text style={styles.colon}>:</Text><ScoreInput value={away} onChange={setAway} disabled={!open} /></View><TeamBlock team={game.awayTeam} /></View>
    {game.homeScore !== null && <Text style={styles.result}>Endstand {game.homeScore}:{game.awayScore} · {game.points ?? 0} Punkte</Text>}
    {open && <Button small label={game.predictedHome === null ? 'Tipp speichern' : 'Tipp ändern'} onPress={() => onSave(game, home, away)} />}
  </View>;
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
    {ordered.map((team, i) => <View key={team.id} style={styles.teamRank}><Text style={styles.rankNo}>{i + 1}</Text><Badge label={team.shortName} /><Text style={styles.teamName}>{team.name}</Text>{open && <View style={styles.arrows}><Pressable onPress={() => move(i, -1)}><Text style={styles.arrow}>↑</Text></Pressable><Pressable onPress={() => move(i, 1)}><Text style={styles.arrow}>↓</Text></Pressable></View>}</View>)}
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
function TeamBlock({ team }: { team: Team }) { return <View style={styles.teamBlock}><Badge label={team.shortName} /><Text numberOfLines={2} style={styles.teamBlockName}>{team.name}</Text></View>; }
function Badge({ label }: { label: string }) { return <View style={styles.badge}><Text style={styles.badgeText}>{label.slice(0, 3)}</Text></View>; }
function Button({ label, onPress, disabled, small }: { label: string; onPress: () => void; disabled?: boolean; small?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, small && styles.buttonSmall, disabled && { opacity: .5 }]}><Text style={styles.buttonText}>{label}</Text></Pressable>; }
function Segment<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) { return <View style={styles.segment}>{options.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.segmentItem, key === value && styles.segmentActive]}><Text style={[styles.segmentText, key === value && styles.segmentTextActive]}>{label}</Text></Pressable>)}</View>; }
function Empty({ text }: { text: string }) { return <View style={styles.empty}><Text style={styles.muted}>{text}</Text></View>; }
function ScreenLoader() { return <SafeAreaView style={styles.safe}><ActivityIndicator style={{ flex: 1 }} color="#b8f341" /></SafeAreaView>; }
function titleFor(tab: Tab) { return ({ spiele: 'Meine Tipps', tabelle: 'Saisontabelle', rangliste: 'Ranglisten', profil: 'Profil' } as const)[tab]; }
function openLegalPage(path: string) { if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(path); }
function mapRank(row: any): LeaderboardEntry { return { rank: Number(row.rank), displayName: row.display_name, points: Number(row.points), exactTips: row.exact_tips === undefined ? undefined : Number(row.exact_tips) }; }
function mapGame(row: any): Game { return { id: row.id, phase: row.phase, startsAt: row.starts_at, homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name }, awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name }, homeScore: row.home_score, awayScore: row.away_score, predictedHome: row.predicted_home, predictedAway: row.predicted_away, points: row.prediction_points }; }

const c = { bg: '#071426', panel: '#0d2038', panel2: '#122a48', ink: '#f4f8fc', muted: '#8fa3b9', lime: '#b8f341', blue: '#2f80ed', red: '#ff6b6b', line: '#203a58' };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, content: { flex: 1 }, contentInner: { padding: 18, paddingBottom: 34 }, header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, kicker: { color: c.lime, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }, title: { color: c.ink, fontSize: 28, fontWeight: '900', marginTop: 3 }, puck: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.panel2, justifyContent: 'center', alignItems: 'center' }, demoBanner: { backgroundColor: c.lime, paddingVertical: 7, alignItems: 'center' }, demoText: { color: c.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1 }, nav: { borderTopWidth: 1, borderTopColor: c.line, backgroundColor: '#09182a', flexDirection: 'row', paddingTop: 8, paddingBottom: 10 }, navItem: { flex: 1, alignItems: 'center', gap: 3 }, navIcon: { color: c.muted, fontSize: 19 }, navLabel: { color: c.muted, fontSize: 10, fontWeight: '700' }, active: { color: c.lime }, segment: { padding: 4, borderRadius: 12, backgroundColor: c.panel, flexDirection: 'row', marginBottom: 14 }, segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' }, segmentActive: { backgroundColor: c.lime }, segmentText: { color: c.muted, fontWeight: '800' }, segmentTextActive: { color: c.bg }, sectionHint: { color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: 15 }, card: { borderRadius: 16, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 16, marginBottom: 13 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }, date: { color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }, state: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, closed: { color: c.red }, matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, teamBlock: { width: '28%', alignItems: 'center' }, teamBlockName: { color: c.ink, textAlign: 'center', fontSize: 12, fontWeight: '700', marginTop: 8 }, badge: { minWidth: 42, height: 42, borderRadius: 12, backgroundColor: c.panel2, borderWidth: 1, borderColor: '#315274', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, badgeText: { color: c.ink, fontWeight: '900', fontSize: 11 }, scoreInputs: { flexDirection: 'row', alignItems: 'center' }, score: { width: 48, height: 52, borderRadius: 10, backgroundColor: '#07182b', color: c.ink, fontSize: 24, fontWeight: '900', textAlign: 'center', borderWidth: 1, borderColor: '#315274' }, scoreDisabled: { color: c.muted }, colon: { color: c.muted, fontSize: 24, paddingHorizontal: 7 }, result: { color: c.lime, textAlign: 'center', marginTop: 14, fontWeight: '700' }, button: { backgroundColor: c.lime, borderRadius: 11, paddingVertical: 14, alignItems: 'center', marginTop: 16 }, buttonSmall: { paddingVertical: 10 }, buttonText: { color: c.bg, fontWeight: '900' }, deadline: { backgroundColor: c.panel2, borderLeftWidth: 4, borderLeftColor: c.lime, borderRadius: 10, padding: 14, marginBottom: 13 }, deadlineLabel: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, deadlineValue: { color: c.ink, fontSize: 17, fontWeight: '800', marginTop: 3 }, teamRank: { flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 10 }, rankNo: { width: 25, color: c.muted, fontWeight: '900', textAlign: 'center' }, teamName: { color: c.ink, flex: 1, fontWeight: '700' }, arrows: { flexDirection: 'row', gap: 10 }, arrow: { color: c.lime, fontSize: 23, padding: 4 }, rankingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.panel, borderRadius: 12, padding: 14, marginBottom: 8 }, rankingName: { flex: 1, color: c.ink, fontWeight: '800' }, exacts: { color: c.muted, fontSize: 12, marginRight: 12 }, points: { color: c.lime, fontSize: 17, fontWeight: '900' }, empty: { padding: 40, alignItems: 'center' }, authWrap: { flex: 1, padding: 24, justifyContent: 'center' }, brand: { color: c.lime, fontSize: 13, fontWeight: '900', letterSpacing: 3 }, authTitle: { color: c.ink, fontSize: 34, fontWeight: '900', marginTop: 8, marginBottom: 8 }, muted: { color: c.muted, lineHeight: 20 }, fieldWrap: { marginTop: 18 }, label: { color: c.muted, fontSize: 12, fontWeight: '800', marginBottom: 7 }, field: { backgroundColor: c.panel, color: c.ink, borderRadius: 11, borderWidth: 1, borderColor: c.line, padding: 14, fontSize: 16 }, link: { color: c.lime, textAlign: 'center', padding: 18, fontWeight: '700' }, legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 6 }, legalLink: { color: c.lime, fontWeight: '700', paddingVertical: 8 }, cardTitle: { color: c.ink, fontSize: 20, fontWeight: '900', marginBottom: 5 }, spacer: { height: 15 }, danger: { color: c.red, textAlign: 'center', marginTop: 20, fontWeight: '800' }, legalHeading: { color: c.ink, fontWeight: '900', marginTop: 16, marginBottom: 5 }, legalText: { color: c.muted, lineHeight: 21, marginTop: 6 }
});
