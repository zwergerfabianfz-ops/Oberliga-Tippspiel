import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
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
import { parseAuthCallback } from './src/authCallback';
import { authErrorMessage, registrationErrorMessage, withAuthTimeout } from './src/authErrors';
import { displayNameValidationError, normalizeDisplayName } from './src/displayNames';
import { gameTipsCsv } from './src/csv';
import { arePreseasonGamesVisible, gamesForNextMatchday } from './src/gameFilters';
import { liveClockLabel } from './src/liveGame';
import { isOfficiallyLive } from './src/liveStatus';
import { disablePushNotifications, enablePushNotifications, pushNotificationsEnabled, pushNotificationsSupported } from './src/notifications';
import { configurePwa } from './src/pwa';
import { isAllowedGameTip, isTipOpen } from './src/scoring';
import { isBackendConfigured, supabase } from './src/supabase';
import type { Game, LeaderboardEntry, LiveStanding, PlayerFinalTip, RecentPrediction, Season, Team } from './src/types';

type Tab = 'spiele' | 'verlauf' | 'tabelle' | 'rangliste' | 'profil';
type AuthNotice = { kind: 'success' | 'error'; message: string };

const demoSeason: Season = { id: 'demo', name: 'Oberliga Süd 2026/27', tablePredictionDeadline: '2026-09-17T21:59:59.000Z', status: 'upcoming' };

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    configurePwa();
    if (!isBackendConfigured) { setLoading(false); return; }
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    async function initializeAuth() {
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const callback = parseAuthCallback(window.location.href);
        if (callback) {
          if (callback.kind === 'error') {
            setAuthNotice({ kind: 'error', message: callback.errorCode === 'otp_expired' ? 'Der Bestätigungslink ist abgelaufen oder wurde bereits verwendet.' : 'Die E-Mail-Adresse konnte nicht bestätigt werden.' });
          } else {
            let confirmationError = null;
            if (callback.code) ({ error: confirmationError } = await supabase.auth.exchangeCodeForSession(callback.code));
            else if (callback.accessToken && callback.refreshToken) ({ error: confirmationError } = await supabase.auth.setSession({ access_token: callback.accessToken, refresh_token: callback.refreshToken }));
            if (callback.kind === 'recovery' && !confirmationError) setPasswordRecovery(true);
            else setAuthNotice(confirmationError
              ? { kind: 'error', message: callback.kind === 'recovery' ? 'Der Link zum Zurücksetzen ist ungültig oder abgelaufen.' : 'Der Bestätigungslink konnte nicht verarbeitet werden. Versuche dich bitte anzumelden.' }
              : { kind: 'success', message: 'Deine E-Mail-Adresse wurde bestätigt. Dein Konto ist jetzt einsatzbereit.' });
          }
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }
      const { data: current } = await supabase.auth.getSession();
      setSession(current.session);
      setLoading(false);
    }
    initializeAuth();
    return () => data.subscription.unsubscribe();
  }, []);

  if (loading) return <ScreenLoader />;
  if (authNotice) return <AuthConfirmationScreen notice={authNotice} signedIn={Boolean(session)} onContinue={() => setAuthNotice(null)} />;
  if (passwordRecovery && session) return <ResetPasswordScreen onComplete={() => setPasswordRecovery(false)} />;
  if (!session && isBackendConfigured) return <AuthScreen />;
  return <MainApp session={session} />;
}

function AuthConfirmationScreen({ notice, signedIn, onContinue }: { notice: AuthNotice; signedIn: boolean; onContinue: () => void }) {
  return <SafeAreaView style={styles.safe}><View style={styles.authWrap}>
    <Text style={styles.brand}>{notice.kind === 'success' ? '✓ BESTÄTIGT' : 'LINK NICHT GÜLTIG'}</Text>
    <Text style={styles.authTitle}>{notice.kind === 'success' ? 'Willkommen beim Tippspiel!' : 'Bestätigung fehlgeschlagen'}</Text>
    <Text style={styles.muted}>{notice.message}</Text>
    <Button label={notice.kind === 'success' && signedIn ? 'Tippspiel öffnen' : 'Zur Anmeldung'} onPress={onContinue} />
    {Platform.OS === 'web' && <Pressable onPress={() => openLegalPage('/quickstart.html')}><Text style={styles.link}>Installation & Quickstart</Text></Pressable>}
  </View></SafeAreaView>;
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  async function requestPasswordReset() {
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFeedback({ kind: 'error', text: 'Bitte gib zuerst deine E-Mail-Adresse ein.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(normalizedEmail, { redirectTo: confirmationRedirectUrl() }));
      if (error) throw error;
      setFeedback({ kind: 'success', text: 'Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde ein Link zum Zurücksetzen versendet.' });
    } catch (error) {
      const text = error instanceof Error && error.message === 'Zeitüberschreitung'
        ? 'Der Anmeldedienst antwortet gerade nicht. Bitte versuche es erneut.'
        : 'Die E-Mail zum Zurücksetzen konnte nicht versendet werden. Bitte versuche es erneut.';
      setFeedback({ kind: 'error', text });
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (busy) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setFeedback({ kind: 'error', text: 'Bitte gib zuerst deine E-Mail-Adresse ein.' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await withAuthTimeout(supabase.auth.resend({ type: 'signup', email: normalizedEmail, options: { emailRedirectTo: confirmationRedirectUrl() } }));
      if (error) {
        setFeedback({ kind: 'error', text: registrationErrorMessage(error) });
        return;
      }
      setFeedback({ kind: 'success', text: 'Die Bestätigungs-E-Mail wurde erneut versendet. Bitte prüfe auch den Spam-Ordner.' });
    } catch {
      setFeedback({ kind: 'error', text: 'Die Bestätigungs-E-Mail konnte gerade nicht versendet werden. Bitte versuche es später erneut.' });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy) return;
    const normalizedName = normalizeDisplayName(name);
    const nameError = mode === 'register' ? displayNameValidationError(normalizedName) : null;
    if (!email.trim() || password.length < 8 || nameError) {
      const text = nameError ?? 'Bitte gib eine gültige E-Mail-Adresse und mindestens 8 Zeichen als Passwort ein.';
      setFeedback({ kind: 'error', text });
      Alert.alert('Eingaben prüfen', text);
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      if (mode === 'register') {
        const { data: available, error } = await withAuthTimeout(supabase.rpc('is_display_name_available', { p_display_name: normalizedName }));
        if ((error && !isMissingRpcError(error.code)) || available === false) {
          const text = error ? 'Der Anzeigename konnte gerade nicht geprüft werden. Bitte versuche es erneut.' : 'Dieser Anzeigename ist vergeben oder für eine noch unbestätigte Registrierung reserviert. Wenn das dein eigener Versuch war, sende dir auf der Anmeldeseite die Bestätigungs-E-Mail erneut.';
          setFeedback({ kind: 'error', text });
          Alert.alert(error ? 'Prüfung nicht möglich' : 'Name bereits vergeben', text);
          return;
        }
      }
      const normalizedEmail = email.trim().toLowerCase();
      const result = mode === 'login'
        ? await withAuthTimeout(supabase.auth.signInWithPassword({ email: normalizedEmail, password }))
        : await withAuthTimeout(supabase.auth.signUp({ email: normalizedEmail, password, options: { data: { display_name: normalizedName }, emailRedirectTo: confirmationRedirectUrl() } }));
      if (result.error) {
        const text = mode === 'register' ? registrationErrorMessage(result.error) : authErrorMessage(result.error);
        setFeedback({ kind: 'error', text });
        Alert.alert('Anmeldung fehlgeschlagen', text);
      } else if (mode === 'register' && !result.data.session) {
        const text = 'Bitte bestätige deine E-Mail-Adresse. Danach kannst du dich anmelden.';
        setFeedback({ kind: 'success', text });
        Alert.alert('Fast geschafft', text);
      } else if (mode === 'login' && !result.data.session) {
        const text = 'Die Anmeldung wurde nicht abgeschlossen. Bitte bestätige deine E-Mail-Adresse oder versuche es erneut.';
        setFeedback({ kind: 'error', text });
        Alert.alert('Anmeldung nicht abgeschlossen', text);
      }
    } catch (error) {
      const text = error instanceof Error && error.message === 'Zeitüberschreitung'
        ? 'Der Anmeldedienst antwortet gerade nicht. Bitte prüfe die Internetverbindung und versuche es erneut.'
        : 'Beim Anmelden ist ein technischer Fehler aufgetreten. Bitte versuche es erneut.';
      setFeedback({ kind: 'error', text });
      Alert.alert('Anmeldung fehlgeschlagen', text);
    } finally {
      setBusy(false);
    }
  }

  return <SafeAreaView style={styles.safe}><View style={styles.authWrap}>
    <Text style={styles.brand}>POWERPLAY</Text><Text style={styles.authTitle}>Oberliga Tippspiel</Text>
    <Text style={styles.muted}>Tippe jedes Spiel. Beweise dein Tabellengefühl.</Text>
    {mode === 'register' && <Field label="Anzeigename" value={name} onChangeText={setName} />}
    <Field label="E-Mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
    <Field label="Passwort" value={password} onChangeText={setPassword} secureTextEntry />
    <Button label={busy ? 'Bitte warten …' : mode === 'login' ? 'Einloggen' : 'Konto erstellen'} onPress={submit} disabled={busy} />
    {feedback && <Text accessibilityRole="alert" style={[styles.authFeedback, feedback.kind === 'error' ? styles.authFeedbackError : styles.authFeedbackSuccess]}>{feedback.text}</Text>}
    {mode === 'login' && <View style={styles.authHelpLinks}><Pressable disabled={busy} onPress={requestPasswordReset}><Text style={styles.passwordResetLink}>Passwort vergessen?</Text></Pressable><Pressable disabled={busy} onPress={resendConfirmation}><Text style={styles.passwordResetLink}>Bestätigungs-E-Mail erneut senden</Text></Pressable></View>}
    <Pressable onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setFeedback(null); }}><Text style={styles.link}>{mode === 'login' ? 'Noch kein Konto? Registrieren' : 'Schon registriert? Einloggen'}</Text></Pressable>
    {Platform.OS === 'web' && <><View style={styles.legalLinks}><Pressable onPress={() => openLegalPage('/quickstart.html')}><Text style={styles.legalLink}>Installation & Quickstart</Text></Pressable></View><View style={styles.legalLinks}><Pressable onPress={() => openLegalPage('/datenschutz.html')}><Text style={styles.legalLink}>Datenschutz</Text></Pressable><Text style={styles.muted}>·</Text><Pressable onPress={() => openLegalPage('/impressum.html')}><Text style={styles.legalLink}>Impressum</Text></Pressable></View></>}
  </View></SafeAreaView>;
}

function ResetPasswordScreen({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function savePassword() {
    if (busy) return;
    if (password.length < 8) { setFeedback('Das neue Passwort muss mindestens 8 Zeichen lang sein.'); return; }
    if (password !== confirmation) { setFeedback('Die beiden Passwörter stimmen nicht überein.'); return; }
    setBusy(true);
    setFeedback(null);
    try {
      const { error } = await withAuthTimeout(supabase.auth.updateUser({ password }));
      if (error) { setFeedback(error.message); return; }
      Alert.alert('Passwort geändert', 'Du kannst das Tippspiel jetzt wieder verwenden.');
      onComplete();
    } catch {
      setFeedback('Das Passwort konnte nicht gespeichert werden. Bitte öffne den Link erneut oder fordere einen neuen an.');
    } finally {
      setBusy(false);
    }
  }

  return <SafeAreaView style={styles.safe}><View style={styles.authWrap}>
    <Text style={styles.brand}>PASSWORT ZURÜCKSETZEN</Text>
    <Text style={styles.authTitle}>Neues Passwort</Text>
    <Text style={styles.muted}>Wähle ein neues Passwort mit mindestens 8 Zeichen.</Text>
    <Field label="Neues Passwort" value={password} onChangeText={setPassword} secureTextEntry />
    <Field label="Passwort wiederholen" value={confirmation} onChangeText={setConfirmation} secureTextEntry />
    <Button label={busy ? 'Bitte warten …' : 'Neues Passwort speichern'} onPress={savePassword} disabled={busy} />
    {feedback && <Text accessibilityRole="alert" style={[styles.authFeedback, styles.authFeedbackError]}>{feedback}</Text>}
  </View></SafeAreaView>;
}

function MainApp({ session }: { session: Session | null }) {
  const [tab, setTab] = useState<Tab>('spiele');
  const [games, setGames] = useState<Game[]>([]);
  const [season, setSeason] = useState<Season>(demoSeason);
  const [teams, setTeams] = useState<Team[]>([]);
  const [liveStandings, setLiveStandings] = useState<LiveStanding[]>([]);
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
    const [{ data: teamRows }, { data: standingRows }] = current ? await Promise.all([
      supabase.from('teams').select('*').eq('season_id', current.id).order('name'),
      supabase.from('team_standings').select('*').eq('season_id', current.id).order('position'),
    ]) : [{ data: null }, { data: null }];
    const teamsById = new Map<string, Team>();
    if (teamRows?.length) {
      const regularTeamIds = new Set((gameRows ?? [])
        .filter(game => game.phase === 'regular' && !game.is_preseason)
        .flatMap(game => [game.home_team_id, game.away_team_id]));
      const mapped: Team[] = teamRows.map(t => ({
        id: t.id,
        name: t.name,
        shortName: t.short_name,
        logoUrl: t.logo_url,
        isCompetitor: regularTeamIds.size ? regularTeamIds.has(t.id) : t.is_competitor !== false,
      }));
      mapped.forEach(team => teamsById.set(team.id, team));
      const competitors = mapped.filter(team => team.isCompetitor !== false);
      const { data: savedOrder } = await supabase.from('table_predictions').select('team_id,predicted_position').eq('season_id', current.id).order('predicted_position');
      const byId = new Map(competitors.map(team => [team.id, team]));
      const ordered = (savedOrder ?? []).flatMap(item => {
        const team = byId.get(item.team_id);
        return team ? [team] : [];
      });
      setTeams(ordered?.length === competitors.length ? ordered : competitors);
      setLiveStandings((standingRows ?? []).flatMap(row => {
        const team = teamsById.get(row.team_id);
        return team ? [{
          team,
          position: Number(row.position),
          gamesPlayed: Number(row.games_played),
          wins: Number(row.wins),
          losses: Number(row.losses),
          goalsFor: Number(row.goals_for),
          goalsAgainst: Number(row.goals_against),
          goalDifference: Number(row.goal_difference),
          points: Number(row.points),
        }] : [];
      }));
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
    const timer = setInterval(() => refreshLiveScores(), 15_000);
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
      {tab === 'tabelle' && <TableTipScreen season={season} teams={teams} liveStandings={liveStandings} session={session} onSaved={setTeams} />}
      {tab === 'rangliste' && <RankingScreen games={gameRanking} table={tableRanking} season={season} />}
      {tab === 'profil' && <ProfileScreen session={session} games={games} onRefresh={load} />}
    </ScrollView>
    <View style={styles.nav}>{(['spiele', 'verlauf', 'tabelle', 'rangliste', 'profil'] as Tab[]).map(item => <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}><Text style={[styles.navIcon, tab === item && styles.active]}>{({ spiele: '◫', verlauf: '◷', tabelle: '≡', rangliste: '♛', profil: '●' } as const)[item]}</Text><Text style={[styles.navLabel, tab === item && styles.active]}>{item[0]!.toUpperCase() + item.slice(1)}</Text></Pressable>)}</View>
  </SafeAreaView>;
}

function GamesScreen({ games, setGames, session }: { games: Game[]; setGames: Dispatch<SetStateAction<Game[]>>; session: Session | null }) {
  const [phase, setPhase] = useState<Game['phase']>('regular');
  const [scope, setScope] = useState<'next' | 'all'>('next');
  const [liveGameDetails, setLiveGameDetails] = useState<Game | null>(null);
  const preseasonVisible = arePreseasonGamesVisible(games);
  const phases: Game['phase'][] = preseasonVisible ? ['regular', 'preseason', 'playoffs'] : ['regular', 'playoffs'];
  useEffect(() => {
    if (phase === 'preseason' && !preseasonVisible) setPhase('regular');
  }, [phase, preseasonVisible]);
  const liveGames = games.filter(game => game.isLive).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const phaseGames = games.filter(game => game.phase === phase);
  const shown = scope === 'next' ? gamesForNextMatchday(phaseGames) : phaseGames;
  const shownTips = shown.filter(game => !game.isLive);
  const save = useCallback(async (game: Game, home: string, away: string): Promise<boolean> => {
    const h = Number(home), a = Number(away);
    if (!isAllowedGameTip(h, a)) return false;
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
    {liveGames.length > 0 && <View style={styles.liveSection}>
      <Text style={styles.liveSectionTitle}>● LIVE-SPIELE</Text>
      {liveGames.map(game => <LiveGameCard key={game.id} game={game} onPress={() => setLiveGameDetails(game)} />)}
    </View>}
    <View style={styles.filterRow}>
      <FilterButton label="Phase" value={phaseLabel} onPress={nextPhase} />
      <FilterButton label="Anzeige" value={scope === 'next' ? 'Nächster Spieltag' : 'Alle Spiele'} onPress={() => setScope(current => current === 'next' ? 'all' : 'next')} />
    </View>
    <Text style={styles.sectionHint}>{phase === 'preseason' ? 'Testspiele dienen nur zum Ausprobieren und zählen nicht für die Rangliste. ' : ''}{scope === 'next' ? 'Spiele des nächsten Spieltags. Ein einzelnes vorgezogenes Spiel wird zusammen mit dem folgenden Spieltermin angezeigt. ' : ''}Tipps bleiben bis zum offiziellen Spielbeginn änderbar.</Text>
    {shownTips.map(game => <GameCard key={game.id} game={game} onSave={save} />)}
    {!shownTips.length && !liveGames.length && <Empty text={scope === 'next' ? 'Kein weiterer Spieltag in dieser Phase.' : 'Noch keine Spiele in dieser Phase.'} />}
    <LiveGameDetailsModal game={liveGameDetails} onClose={() => setLiveGameDetails(null)} />
  </>;
}

function LiveGameCard({ game, onPress }: { game: Game; onPress: () => void }) {
  const date = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }).format(new Date(game.startsAt));
  return <Pressable accessibilityRole="button" accessibilityLabel={`Spielbericht für ${game.homeTeam.name} gegen ${game.awayTeam.name} öffnen`} onPress={onPress} style={[styles.card, styles.liveCard]}>
    <View style={styles.cardTop}><Text style={styles.date}>{date} Uhr</Text><Text style={[styles.state, styles.live]}>LIVE</Text></View>
    <View style={[styles.historyMatch, styles.liveMatch]}>
      <View style={styles.historyTeam}><TeamLogo team={game.homeTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.homeTeam.name}</Text></View>
      <View style={styles.liveScoreBlock}><Text style={styles.liveScore}>{game.homeScore ?? 0} : {game.awayScore ?? 0}</Text><Text style={styles.liveMinute}>{liveClockLabel(game.liveElapsedSeconds, game.livePhase)}</Text><Text style={styles.liveScoreLabel}>AKTUELLER STAND</Text></View>
      <View style={styles.historyTeam}><TeamLogo team={game.awayTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.awayTeam.name}</Text></View>
    </View>
    <Text style={styles.liveDetailsHint}>Spielbericht anzeigen ›</Text>
  </Pressable>;
}

type LiveEvent = { id: string; type: 'goal' | 'penalty'; team: 'home' | 'away'; seconds: number; time: string; period: string; player: string; score: string; detail: string; strength: string };

function LiveGameDetailsModal({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!game) return;
    setLoading(true); setError(null);
    const { data, error: fetchError } = await supabase.functions.invoke('sync-deb', { body: { gameId: game.externalId } });
    if (fetchError) { setError('Der Spielbericht konnte gerade nicht geladen werden.'); setLoading(false); return; }
    setEvents(Array.isArray(data?.events) ? data.events : []);
    setLoading(false);
  }, [game]);
  useEffect(() => {
    if (!game) { setEvents([]); setError(null); return; }
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [game, load]);
  if (!game) return null;
  return <Modal transparent animationType="slide" visible onRequestClose={onClose}>
    <View style={styles.modalBackdrop}><SafeAreaView style={styles.modalSheet}>
      <View style={styles.modalHeader}><View><Text style={styles.brand}>LIVE-SPIELBERICHT</Text><Text style={styles.modalTitle}>{game.homeTeam.shortName} – {game.awayTeam.shortName}</Text></View><Pressable onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable></View>
      <Text style={styles.modalSubtitle}>{game.homeScore ?? 0} : {game.awayScore ?? 0} · {liveClockLabel(game.liveElapsedSeconds, game.livePhase)}</Text>
      {loading && !events.length ? <ActivityIndicator color={c.lime} style={styles.modalLoading} /> : error ? <Text style={styles.modalError}>{error}</Text> : <ScrollView contentContainerStyle={styles.liveEvents}>
        {!events.length ? <Text style={styles.muted}>Noch keine Tore oder Strafen erfasst.</Text> : events.map(event => <View key={event.id} style={styles.liveEvent}>
          <Text style={[styles.liveEventTime, event.type === 'goal' ? styles.goalEvent : styles.penaltyEvent]}>{event.time}</Text>
          <View style={styles.liveEventMain}><Text style={styles.liveEventTitle}>{event.type === 'goal' ? 'TOR' : 'STRAFE'} · {event.team === 'home' ? game.homeTeam.name : game.awayTeam.name}</Text><Text style={styles.liveEventPlayer}>{event.player || 'Unbekannter Spieler'}</Text>{Boolean(event.detail) && <Text style={styles.liveEventDetail}>{event.type === 'goal' ? `Vorlagen: ${event.detail}` : event.detail}</Text>}</View>
          <Text style={styles.liveEventResult}>{event.type === 'goal' ? event.score : event.strength}</Text>
        </View>)}</ScrollView>}
      {loading && events.length > 0 && <ActivityIndicator color={c.lime} style={styles.modalRefreshing} />}
    </SafeAreaView></View>
  </Modal>;
}

function GameCard({ game, onSave }: { game: Game; onSave: (g: Game, h: string, a: string) => Promise<boolean> }) {
  const [home, setHome] = useState(game.predictedHome?.toString() ?? '');
  const [away, setAway] = useState(game.predictedAway?.toString() ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'draw'>(game.predictedHome === null ? 'idle' : 'saved');
  const lastSaved = useRef(game.predictedHome === null || game.predictedAway === null ? '' : `${game.predictedHome}:${game.predictedAway}`);
  const open = isTipOpen(game.startsAt);
  useEffect(() => {
    if (!open || !/^\d{1,2}$/.test(home) || !/^\d{1,2}$/.test(away) || Number(home) > 30 || Number(away) > 30) {
      setSaveState('idle');
      return;
    }
    if (Number(home) === Number(away)) {
      setSaveState('draw');
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
    {open && saveState !== 'idle' && <Text style={[styles.saveStatus, (saveState === 'error' || saveState === 'draw') && styles.saveError]}>{saveState === 'saved' ? '✓ Gespeichert' : saveState === 'draw' ? 'Unentschieden sind im Eishockey nicht möglich.' : saveState === 'error' ? 'Nicht gespeichert' : saveState === 'saving' ? 'Speichert …' : 'Wird gespeichert …'}</Text>}
  </View>;
}

function TipsHistoryScreen({ predictions }: { predictions: RecentPrediction[] }) {
  const [openGameId, setOpenGameId] = useState<string | null>(null);
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
      const tipsOpen = openGameId === game.gameId;
      return <View key={game.gameId} style={styles.card}>
        <View style={styles.cardTop}><Text style={styles.date}>{date} Uhr</Text><Text style={[styles.state, styles.closed, game.isLive && styles.live]}>{game.isLive ? 'LIVE' : game.isFinal ? 'BEENDET' : 'GESTARTET'}</Text></View>
        <View style={styles.historyMatch}>
          <View style={styles.historyTeam}><TeamLogo team={game.homeTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.homeTeam.name}</Text></View>
          <Text style={[styles.historyScore, styles.historyScoreAligned, game.isLive && styles.liveText]}>{game.homeScore === null ? '– : –' : `${game.homeScore} : ${game.awayScore}`}</Text>
          <View style={styles.historyTeam}><TeamLogo team={game.awayTeam} /><Text numberOfLines={2} style={styles.historyTeamName}>{game.awayTeam.name}</Text></View>
        </View>
        <Pressable style={styles.historyToggle} onPress={() => setOpenGameId(current => current === game.gameId ? null : game.gameId)} accessibilityRole="button" accessibilityState={{ expanded: tipsOpen }}>
          <Text style={styles.historyToggleText}>{tipsOpen ? 'Tipps ausblenden' : `${tips.length} ${tips.length === 1 ? 'Tipp' : 'Tipps'} anzeigen`}</Text><Text style={styles.historyToggleArrow}>{tipsOpen ? '▲' : '▼'}</Text>
        </Pressable>
        {tipsOpen && <View style={styles.tipList}>
          <View style={styles.tipHeader}><Text style={styles.tipHeaderName}>SPIELER</Text><Text style={styles.tipHeaderValue}>TIPP</Text><Text style={styles.tipHeaderPoints}>PUNKTE</Text></View>
          {tips.map((tip, index) => <View key={`${tip.gameId}-${tip.displayName}-${index}`} style={styles.tipRow}>
            <View style={styles.tipNameColumn}><Text numberOfLines={1} style={styles.tipName}>{tip.displayName}</Text></View>
            <View style={styles.tipValueColumn}><Text style={styles.tipValue}>{tip.predictedHome}:{tip.predictedAway}</Text></View>
            <View style={styles.tipPointsColumn}><Text style={styles.tipPoints}>{game.isFinal && tip.points !== null ? `${tip.points} P` : '–'}</Text></View>
          </View>)}
        </View>}
      </View>;
    })}
    {!games.size && <Empty text="In den letzten 14 Tagen gibt es noch keine sichtbaren Tipps." />}
  </>;
}

function TableTipScreen({ season, teams, liveStandings, session, onSaved }: { season: Season; teams: Team[]; liveStandings: LiveStanding[]; session: Session | null; onSaved: (teams: Team[]) => void }) {
  const [view, setView] = useState<'live' | 'prediction'>('live');
  const [ordered, setOrdered] = useState(teams);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const open = new Date() < new Date(season.tablePredictionDeadline);
  useEffect(() => setOrdered(teams), [teams]);
  function move(index: number, delta: number) { const next = [...ordered]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; setOrdered(next); setSaveState('idle'); setSaveMessage(''); }
  async function save() {
    if (!open || saveState === 'saving') return;
    setSaveState('saving');
    setSaveMessage('Tabellentipp wird gespeichert …');
    try {
      if (session) {
        const { error } = await supabase.rpc('save_table_prediction', { p_season_id: season.id, p_team_ids: ordered.map(t => t.id) });
        if (error) {
          setSaveState('error');
          setSaveMessage(`Nicht gespeichert: ${error.message}`);
          Alert.alert('Nicht gespeichert', error.message);
          return;
        }
      }
      onSaved([...ordered]);
      setSaveState('saved');
      setSaveMessage('✓ Tabellentipp gespeichert. Du kannst ihn bis zur Deadline weiter ändern.');
    } catch {
      setSaveState('error');
      setSaveMessage('Nicht gespeichert. Bitte prüfe deine Internetverbindung und versuche es erneut.');
    }
  }
  const deadline = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(season.tablePredictionDeadline));
  return <>
    <Segment options={[['live', 'Live-Tabelle'], ['prediction', 'Mein Tabellentipp']]} value={view} onChange={setView} />
    {view === 'live' ? <>
      <Text style={styles.sectionHint}>Aktueller Stand der Hauptrunde. Die Tabelle wird beim Öffnen der App aktualisiert.</Text>
      <View style={styles.liveTableHeader}><Text style={styles.liveTableRank}>#</Text><Text style={styles.liveTableTeam}>TEAM</Text><Text style={styles.liveTableStats}>SP</Text><Text style={styles.liveTableStats}>TORE</Text><Text style={styles.liveTablePoints}>P</Text></View>
      {liveStandings.map(standing => <View key={standing.team.id} style={styles.liveTableRow}>
        <Text style={styles.liveTableRank}>{standing.position}</Text><TeamLogo team={standing.team} /><Text numberOfLines={1} style={styles.liveTableTeam}>{standing.team.name}</Text><Text style={styles.liveTableStats}>{standing.gamesPlayed}</Text><Text style={styles.liveTableStats}>{standing.goalsFor}:{standing.goalsAgainst}</Text><Text style={styles.liveTablePoints}>{standing.points}</Text>
      </View>)}
      {!liveStandings.length && <Empty text="Die Live-Tabelle wird gerade geladen. Bitte aktualisiere die Daten in wenigen Sekunden noch einmal." />}
    </> : <>
      <View style={styles.deadline}><Text style={styles.deadlineLabel}>{open ? 'ABGABE BIS' : 'ABGABE BEENDET'}</Text><Text style={styles.deadlineValue}>{deadline} Uhr</Text></View><Text style={styles.sectionHint}>Sortiere alle Teams auf ihre erwartete Abschlussposition. Pro Team gibt es bei {teams.length} Teams maximal {teams.length} Punkte; jeder Platz Abweichung kostet einen Punkt.</Text>
      {ordered.map((team, i) => <View key={team.id} style={styles.teamRank}><Text style={styles.rankNo}>{i + 1}</Text><TeamLogo team={team} /><Text style={styles.teamName}>{team.name}</Text>{open && <View style={styles.arrows}><Pressable onPress={() => move(i, -1)}><Text style={styles.arrow}>↑</Text></Pressable><Pressable onPress={() => move(i, 1)}><Text style={styles.arrow}>↓</Text></Pressable></View>}</View>)}
      {open && <Button label={saveState === 'saving' ? 'Speichert …' : saveState === 'saved' ? 'Erneut speichern' : 'Tabellentipp speichern'} onPress={save} disabled={saveState === 'saving'} />}
      {saveState !== 'idle' && <Text accessibilityRole="alert" style={[styles.tableSaveFeedback, saveState === 'error' && styles.saveError]}>{saveMessage}</Text>}
    </>}
  </>;
}

function RankingScreen({ games, table, season }: { games: LeaderboardEntry[]; table: LeaderboardEntry[]; season: Season }) {
  const [type, setType] = useState<'games' | 'table'>('games');
  const [selectedPlayer, setSelectedPlayer] = useState<LeaderboardEntry | null>(null);
  const entries = type === 'games' ? games : table;
  return <><Segment options={[['games', 'Spielt Tipps'], ['table', 'Tabellentipps']]} value={type} onChange={setType} /><Text style={styles.sectionHint}>{type === 'games' ? '3 Punkte exakt · 2 Tordifferenz · 1 Sieger' : season.status === 'finished' ? 'Auswertung der Abschlusspositionen' : 'Wird nach Ende der Hauptrunde veröffentlicht.'}</Text>
    {entries.map(entry => <Pressable key={`${entry.rank}-${entry.displayName}`} disabled={type !== 'games' || !entry.userId} onPress={() => setSelectedPlayer(entry)} style={styles.rankingRow}><Text style={[styles.rankNo, entry.rank <= 3 && styles.active]}>{entry.rank}</Text><Text style={styles.rankingName}>{entry.displayName}</Text>{entry.exactTips !== undefined && <Text style={styles.exacts}>{entry.exactTips} exakt</Text>}<Text style={styles.points}>{entry.points} P</Text></Pressable>)}
    {!entries.length && <Empty text="Die Auswertung erscheint nach Ende der Hauptrunde." />}
    <PlayerTipsModal player={selectedPlayer} onClose={() => setSelectedPlayer(null)} />
  </>;
}

function PlayerTipsModal({ player, onClose }: { player: LeaderboardEntry | null; onClose: () => void }) {
  const [tips, setTips] = useState<PlayerFinalTip[]>([]);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<'3' | '2' | '1' | '0'>('3');
  useEffect(() => {
    if (!player?.userId) { setTips([]); return; }
    setLoading(true);
    setPoints('3');
    supabase.rpc('player_final_game_predictions', { p_user_id: player.userId }).then(({ data, error }) => {
      if (error) Alert.alert('Tipps nicht geladen', error.message);
      else setTips((data ?? []).map(mapPlayerFinalTip));
    }).then(() => setLoading(false), () => setLoading(false));
  }, [player?.userId]);
  const shownTips = tips.filter(tip => tip.points === Number(points));
  const pointsLabel = points === '1' ? 'Punkt' : 'Punkte';
  return <Modal visible={Boolean(player)} animationType="slide" transparent onRequestClose={onClose}>
    <View style={styles.modalBackdrop}><SafeAreaView style={styles.modalSheet}>
      <View style={styles.modalHeader}><View><Text style={styles.brand}>SPIELER-TIPPS</Text><Text style={styles.modalTitle}>{player?.displayName}</Text></View><Pressable onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable></View>
      <Text style={styles.muted}>Nur bereits beendete Spiele werden angezeigt.</Text>
      <Segment options={[['3', '3 Punkte'], ['2', '2 Punkte'], ['1', '1 Punkt'], ['0', '0 Punkte']]} value={points} onChange={setPoints} />
      {loading ? <ActivityIndicator color={c.lime} style={styles.modalLoading} /> : <ScrollView contentContainerStyle={styles.modalTips}>
        <View style={styles.pointsSummary}><Text style={styles.pointsSummaryCount}>{shownTips.length}</Text><Text style={styles.pointsSummaryLabel}>{shownTips.length === 1 ? 'Spiel' : 'Spiele'}</Text></View>
        {shownTips.map(tip => <View key={tip.gameId} style={styles.playerTipRow}>
          <Text style={styles.playerTipDate}>{formatGameDate(tip.startsAt)}</Text><Text style={styles.playerTipTeams}>{tip.homeTeamName} – {tip.awayTeamName}</Text>
          <View style={styles.playerTipScores}><Text style={styles.playerTipScore}>Tipp {tip.predictedHome}:{tip.predictedAway}</Text><Text style={styles.playerTipActual}>Endstand {tip.homeScore}:{tip.awayScore}</Text><Text style={styles.playerTipPoints}>{tip.points} P</Text></View>
        </View>)}
        {!shownTips.length && <Empty text={`Keine Tipps mit ${points} ${pointsLabel} verfügbar.`} />}
      </ScrollView>}
    </SafeAreaView></View>
  </Modal>;
}

function ProfileScreen({ session, games, onRefresh }: { session: Session | null; games: Game[]; onRefresh: () => void }) {
  const pushSupported = pushNotificationsSupported();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [displayName, setDisplayName] = useState(() => String(session?.user.user_metadata?.display_name ?? ''));
  const [nameBusy, setNameBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (pushSupported) pushNotificationsEnabled().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, [pushSupported]);
  useEffect(() => {
    if (!session) return;
    supabase.from('profiles').select('display_name,is_admin').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data?.display_name) setDisplayName(data.display_name);
        setIsAdmin(data?.is_admin === true);
      });
  }, [session]);
  async function saveDisplayName() {
    if (!session || nameBusy) return;
    const normalizedName = normalizeDisplayName(displayName);
    const validationError = displayNameValidationError(normalizedName);
    if (validationError) { Alert.alert('Name nicht gespeichert', validationError); return; }
    setNameBusy(true);
    const { data, error } = await supabase.rpc('update_my_display_name', { p_display_name: normalizedName });
    if (error) {
      Alert.alert('Name nicht gespeichert', error.code === '23505' || error.message.includes('bereits vergeben') ? 'Dieser Anzeigename ist bereits vergeben.' : error.message);
    } else {
      const savedName = String(data ?? normalizedName);
      setDisplayName(savedName);
      await supabase.auth.updateUser({ data: { display_name: savedName } });
      onRefresh();
      Alert.alert('Gespeichert', 'Dein Anzeigename wurde geändert.');
    }
    setNameBusy(false);
  }
  async function togglePush() {
    if (!session || pushBusy) return;
    setPushBusy(true);
    try {
      if (pushEnabled) await disablePushNotifications();
      else await enablePushNotifications(session.user.id);
      setPushEnabled(!pushEnabled);
    } catch (error) {
      Alert.alert('Benachrichtigung nicht aktiviert', error instanceof Error ? error.message : 'Bitte versuche es erneut.');
    } finally {
      setPushBusy(false);
    }
  }
  async function signOut() {
    if (pushEnabled) await disablePushNotifications().catch(() => undefined);
    await supabase.auth.signOut();
  }
  return <>
    <View style={styles.card}><Text style={styles.cardTitle}>Mein Konto</Text><Text style={styles.muted}>{session?.user.email ?? 'Demo-Spieler'}</Text>{session && <><Field label="Anzeigename" value={displayName} onChangeText={setDisplayName} maxLength={30} /><Text style={styles.profileHint}>Der Anzeigename ist eindeutig und erscheint in Rangliste und Tippverlauf.</Text><Button label={nameBusy ? 'Bitte warten …' : 'Anzeigename speichern'} onPress={saveDisplayName} disabled={nameBusy} /></>}<View style={styles.spacer} /><Button label="Daten aktualisieren" onPress={onRefresh} />{session && <Pressable onPress={signOut}><Text style={styles.danger}>Abmelden</Text></Pressable>}</View>
    {Platform.OS === 'web' && <View style={styles.card}>
      <Text style={styles.cardTitle}>Tipp-Erinnerung</Text>
      <Text style={styles.muted}>{pushSupported ? 'Erinnert dich etwa eine Stunde vor Spielbeginn – aber nur, wenn dein Tipp für dieses Spiel noch fehlt.' : 'Auf iPhone und iPad funktionieren Benachrichtigungen erst, nachdem du die App über Safari zum Home-Bildschirm hinzugefügt hast.'}</Text>
      {pushSupported && <Button label={pushBusy ? 'Bitte warten …' : pushEnabled ? 'Benachrichtigungen ausschalten' : 'Benachrichtigungen einschalten'} onPress={togglePush} disabled={pushBusy} />}
    </View>}
    {isAdmin && <AdminPanel games={games} onChanged={onRefresh} />}
    <View style={styles.card}>
      <Text style={styles.cardTitle}>WhatsApp-Gruppe</Text>
      <Text style={styles.muted}>Tritt der WhatsApp-Gruppe zum Oberliga-Tippspiel bei.</Text>
      <Button label="WhatsApp-Gruppe beitreten" onPress={() => Linking.openURL('https://chat.whatsapp.com/HSCLswdwhKj3uaVcVAlhMH?s=sh&p=a&mlu=0')} />
    </View>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Hilfe & Installation</Text>
      <Text style={styles.muted}>Schritt-für-Schritt-Anleitung für iPhone, iPad und Android.</Text>
      <Button label="Quickstart Guide öffnen" onPress={() => Linking.openURL('https://oberliga-tippspiel.sued.workers.dev/quickstart.html')} />
    </View>
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

type AdminUser = { user_id: string; display_name: string };
type AdminPrediction = { game_id: string; predicted_home: number; predicted_away: number; points: number | null };

function AdminPanel({ games, onChanged }: { games: Game[]; onChanged: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<Map<string, AdminPrediction>>(new Map());
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    supabase.rpc('admin_list_users').then(({ data, error }) => {
      if (error) { Alert.alert('Admin-Bereich nicht verfügbar', error.message); return; }
      const next = (data ?? []) as AdminUser[];
      setUsers(next);
      setSelectedUserId(current => current ?? next[0]?.user_id ?? null);
    }).then(() => setLoading(false), () => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedUserId) { setPredictions(new Map()); return; }
    supabase.rpc('admin_user_game_predictions', { p_user_id: selectedUserId }).then(({ data, error }) => {
      if (error) { Alert.alert('Tipps nicht geladen', error.message); return; }
      setPredictions(new Map(((data ?? []) as AdminPrediction[]).map(item => [item.game_id, item])));
    });
  }, [selectedUserId]);

  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc('admin_game_tips_export');
      if (error) throw error;
      if (Platform.OS !== 'web' || typeof document === 'undefined') {
        Alert.alert('CSV-Export', 'Der Export steht in der Web-App zur Verfügung.');
        return;
      }
      const blob = new Blob([`\uFEFF${gameTipsCsv(data ?? [])}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `oberliga-tipps-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      Alert.alert('Export nicht möglich', error instanceof Error ? error.message : 'Bitte versuche es erneut.');
    } finally {
      setExporting(false);
    }
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const pastGames = games
    .filter(game => game.phase === 'regular' && new Date(game.startsAt).getTime() <= now && new Date(game.startsAt).getTime() >= sevenDaysAgo)
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  return <View style={[styles.card, styles.adminCard]}>
    <Text style={styles.cardTitle}>Admin: Tipps verwalten</Text>
    <Text style={styles.muted}>Hier kannst nur du Tipps nach Spielbeginn nachtragen oder korrigieren. Angezeigt werden nur Hauptrundenspiele der letzten sieben Tage. Bereits beendete Spiele werden sofort neu bewertet.</Text>
    <Button label={exporting ? 'CSV wird erstellt …' : 'Bisherige Tipps als CSV exportieren'} onPress={exportCsv} disabled={exporting} />
    <Text style={styles.adminLabel}>SPIELER AUSWÄHLEN</Text>
    {loading ? <ActivityIndicator color={c.lime} /> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminUserList}>
      {users.map(user => <Pressable key={user.user_id} onPress={() => setSelectedUserId(user.user_id)} style={[styles.adminUser, selectedUserId === user.user_id && styles.adminUserActive]}><Text style={[styles.adminUserText, selectedUserId === user.user_id && styles.adminUserTextActive]}>{user.display_name}</Text></Pressable>)}
    </ScrollView>}
    {selectedUserId && pastGames.map(game => <AdminGameTip key={`${selectedUserId}-${game.id}`} game={game} prediction={predictions.get(game.id)} userId={selectedUserId} onSaved={(prediction) => {
      setPredictions(current => new Map(current).set(game.id, prediction));
      onChanged();
    }} />)}
    {!loading && !pastGames.length && <Text style={styles.profileHint}>Es gibt noch keine gestarteten Spiele.</Text>}
  </View>;
}

function AdminGameTip({ game, prediction, userId, onSaved }: { game: Game; prediction?: AdminPrediction; userId: string; onSaved: (prediction: AdminPrediction) => void }) {
  const [home, setHome] = useState(prediction?.predicted_home?.toString() ?? '');
  const [away, setAway] = useState(prediction?.predicted_away?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    setHome(prediction?.predicted_home?.toString() ?? '');
    setAway(prediction?.predicted_away?.toString() ?? '');
    setFeedback('');
  }, [prediction?.predicted_away, prediction?.predicted_home]);
  const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(game.startsAt));
  async function save() {
    const h = Number(home), a = Number(away);
    if (!isAllowedGameTip(h, a)) {
      setFeedback(h === a ? 'Unentschieden sind im Eishockey nicht möglich.' : 'Bitte 0 bis 30 Tore eintragen.');
      return;
    }
    setBusy(true);
    setFeedback('');
    const { error } = await supabase.rpc('admin_save_game_prediction', { p_user_id: userId, p_game_id: game.id, p_home: h, p_away: a });
    if (error) setFeedback(`Nicht gespeichert: ${error.message}`);
    else {
      onSaved({ game_id: game.id, predicted_home: h, predicted_away: a, points: game.isFinal && game.homeScore !== null && game.awayScore !== null ? scoreTip(h, a, game.homeScore, game.awayScore) : null });
      setFeedback('✓ Admin-Tipp gespeichert');
    }
    setBusy(false);
  }
  return <View style={styles.adminGame}>
    <Text style={styles.adminGameDate}>{date} Uhr{game.isFinal ? ` · Endstand ${game.homeScore}:${game.awayScore}` : ''}</Text>
    <Text style={styles.adminGameTeams}>{game.homeTeam.name} – {game.awayTeam.name}</Text>
    <View style={styles.adminScoreRow}><ScoreInput value={home} onChange={setHome} disabled={busy} /><Text style={styles.colon}>:</Text><ScoreInput value={away} onChange={setAway} disabled={busy} /><Pressable disabled={busy} onPress={save} style={[styles.adminSave, busy && { opacity: .5 }]}><Text style={styles.adminSaveText}>{busy ? '…' : 'Speichern'}</Text></Pressable></View>
    {feedback && <Text style={[styles.profileHint, feedback.startsWith('Nicht') && styles.saveError]}>{feedback}</Text>}
  </View>;
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
function confirmationRedirectUrl() { return Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined; }
function isMissingRpcError(code?: string) { return code === 'PGRST202' || code === '42883'; }
function scoreTip(predictedHome: number, predictedAway: number, actualHome: number, actualAway: number) {
  if (predictedHome === actualHome && predictedAway === actualAway) return 3;
  if (predictedHome - predictedAway === actualHome - actualAway) return 2;
  return Math.sign(predictedHome - predictedAway) === Math.sign(actualHome - actualAway) ? 1 : 0;
}
function mapRank(row: any): LeaderboardEntry { return { userId: row.user_id, rank: Number(row.rank), displayName: row.display_name, points: Number(row.points), exactTips: row.exact_tips === undefined ? undefined : Number(row.exact_tips) }; }
function mapPlayerFinalTip(row: any): PlayerFinalTip { return { gameId: row.game_id, startsAt: row.starts_at, homeTeamName: row.home_team_name, awayTeamName: row.away_team_name, predictedHome: Number(row.predicted_home), predictedAway: Number(row.predicted_away), homeScore: Number(row.home_score), awayScore: Number(row.away_score), points: Number(row.points) }; }
function formatGameDate(startsAt: string) { return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(startsAt)); }
function mapGame(row: any, teamsById: Map<string, Team>): Game { return { id: row.id, externalId: row.external_id, phase: row.is_preseason ? 'preseason' : row.phase, matchday: row.matchday ?? null, startsAt: row.starts_at, homeTeam: teamsById.get(row.home_team_id) ?? { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name }, awayTeam: teamsById.get(row.away_team_id) ?? { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name }, homeScore: row.home_score, awayScore: row.away_score, isLive: isOfficiallyLive(row.is_live === true, row.starts_at), isFinal: row.is_final ?? false, liveElapsedSeconds: row.live_elapsed_seconds ?? null, livePhase: row.live_phase ?? null, predictedHome: row.predicted_home, predictedAway: row.predicted_away, points: row.prediction_points }; }
function mapRecentPrediction(row: any): RecentPrediction { return { gameId: row.game_id, startsAt: row.starts_at, homeTeam: { id: row.home_team_id, name: row.home_team_name, shortName: row.home_team_short_name, logoUrl: row.home_team_logo_url }, awayTeam: { id: row.away_team_id, name: row.away_team_name, shortName: row.away_team_short_name, logoUrl: row.away_team_logo_url }, homeScore: row.home_score, awayScore: row.away_score, isLive: row.is_live ?? false, isFinal: row.is_final ?? false, displayName: row.display_name, predictedHome: row.predicted_home, predictedAway: row.predicted_away, points: row.points }; }

const c = { bg: '#071426', panel: '#0d2038', panel2: '#122a48', ink: '#f4f8fc', muted: '#8fa3b9', lime: '#b8f341', blue: '#2f80ed', red: '#ff6b6b', line: '#203a58' };
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, content: { flex: 1 }, contentInner: { padding: 18, paddingBottom: 34 }, header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, kicker: { color: c.lime, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }, title: { color: c.ink, fontSize: 28, fontWeight: '900', marginTop: 3 }, puck: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.panel2, justifyContent: 'center', alignItems: 'center' }, demoBanner: { backgroundColor: c.lime, paddingVertical: 7, alignItems: 'center' }, demoText: { color: c.bg, fontWeight: '900', fontSize: 11, letterSpacing: 1 }, nav: { borderTopWidth: 1, borderTopColor: c.line, backgroundColor: '#09182a', flexDirection: 'row', paddingTop: 8, paddingBottom: 10 }, navItem: { flex: 1, alignItems: 'center', gap: 3 }, navIcon: { color: c.muted, fontSize: 19 }, navLabel: { color: c.muted, fontSize: 9, fontWeight: '700' }, active: { color: c.lime }, filterRow: { flexDirection: 'row', gap: 10, marginBottom: 13 }, filterButton: { flex: 1, minWidth: 0, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10 }, filterLabel: { color: c.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }, filterValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, filterValue: { color: c.ink, fontSize: 13, fontWeight: '800', flexShrink: 1 }, filterArrow: { color: c.lime, fontSize: 15, fontWeight: '900' }, segment: { padding: 4, borderRadius: 12, backgroundColor: c.panel, flexDirection: 'row', marginBottom: 14 }, segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' }, segmentActive: { backgroundColor: c.lime }, segmentText: { color: c.muted, fontWeight: '800' }, segmentTextActive: { color: c.bg }, sectionHint: { color: c.muted, fontSize: 13, lineHeight: 19, marginBottom: 15 }, card: { borderRadius: 16, backgroundColor: c.panel, borderWidth: 1, borderColor: c.line, padding: 16, marginBottom: 13 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 }, date: { color: c.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }, state: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1 }, closed: { color: c.red }, live: { color: '#ff3b30' }, liveText: { color: '#ff5a52' }, matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, teamBlock: { width: '28%', alignItems: 'center' }, teamBlockName: { color: c.ink, textAlign: 'center', fontSize: 12, fontWeight: '700', marginTop: 8 }, logoFrame: { backgroundColor: '#f4f8fc', borderWidth: 1, borderColor: '#315274', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, logo: { width: 42, height: 42, borderRadius: 12 }, logoLarge: { width: 58, height: 58, borderRadius: 14 }, logoImage: { width: '86%', height: '86%' }, badge: { minWidth: 42, height: 42, borderRadius: 12, backgroundColor: c.panel2, borderWidth: 1, borderColor: '#315274', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }, badgeText: { color: c.ink, fontWeight: '900', fontSize: 11 }, scoreInputs: { flexDirection: 'row', alignItems: 'center' }, score: { width: 48, height: 52, borderRadius: 10, backgroundColor: '#07182b', color: c.ink, fontSize: 24, fontWeight: '900', textAlign: 'center', borderWidth: 1, borderColor: '#315274' }, scoreDisabled: { color: c.muted }, colon: { color: c.muted, fontSize: 24, paddingHorizontal: 7 }, saveStatus: { color: c.lime, textAlign: 'center', marginTop: 10, fontSize: 11, fontWeight: '800' }, saveError: { color: c.red }, result: { color: c.lime, textAlign: 'center', marginTop: 14, fontWeight: '700' }, historyMatch: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }, historyTeam: { width: '34%', alignItems: 'center', gap: 6 }, historyTeamName: { color: c.ink, textAlign: 'center', fontSize: 11, fontWeight: '700' }, historyScore: { color: c.ink, fontSize: 22, fontWeight: '900' }, tipList: { borderTopWidth: 1, borderTopColor: c.line }, tipRow: { flexDirection: 'row', alignItems: 'center', minHeight: 38, borderBottomWidth: 1, borderBottomColor: c.line }, tipName: { color: c.ink, flex: 1, fontWeight: '700' }, tipValue: { color: c.ink, fontSize: 16, fontWeight: '900', minWidth: 48, textAlign: 'center' }, tipPoints: { color: c.lime, width: 42, textAlign: 'right', fontWeight: '900' }, button: { backgroundColor: c.lime, borderRadius: 11, paddingVertical: 14, alignItems: 'center', marginTop: 16 }, buttonText: { color: c.bg, fontWeight: '900' }, deadline: { backgroundColor: c.panel2, borderLeftWidth: 4, borderLeftColor: c.lime, borderRadius: 10, padding: 14, marginBottom: 13 }, deadlineLabel: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }, deadlineValue: { color: c.ink, fontSize: 17, fontWeight: '800', marginTop: 3 }, teamRank: { flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 10 }, rankNo: { width: 25, color: c.muted, fontWeight: '900', textAlign: 'center' }, teamName: { color: c.ink, flex: 1, fontWeight: '700' }, arrows: { flexDirection: 'row', gap: 10 }, arrow: { color: c.lime, fontSize: 23, padding: 4 }, rankingRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.panel, borderRadius: 12, padding: 14, marginBottom: 8 }, rankingName: { flex: 1, color: c.ink, fontWeight: '800' }, exacts: { color: c.muted, fontSize: 12, marginRight: 12 }, points: { color: c.lime, fontSize: 17, fontWeight: '900' }, empty: { padding: 40, alignItems: 'center' }, authWrap: { flex: 1, padding: 24, justifyContent: 'center' }, brand: { color: c.lime, fontSize: 13, fontWeight: '900', letterSpacing: 3 }, authTitle: { color: c.ink, fontSize: 34, fontWeight: '900', marginTop: 8, marginBottom: 8 }, muted: { color: c.muted, lineHeight: 20 }, fieldWrap: { marginTop: 18 }, label: { color: c.muted, fontSize: 12, fontWeight: '800', marginBottom: 7 }, field: { backgroundColor: c.panel, color: c.ink, borderRadius: 11, borderWidth: 1, borderColor: c.line, padding: 14, fontSize: 16 }, link: { color: c.lime, textAlign: 'center', padding: 18, fontWeight: '700' }, legalLinks: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 6 }, legalLink: { color: c.lime, fontWeight: '700', paddingVertical: 8 }, cardTitle: { color: c.ink, fontSize: 20, fontWeight: '900', marginBottom: 5 }, spacer: { height: 15 }, danger: { color: c.red, textAlign: 'center', marginTop: 20, fontWeight: '800' }, legalHeading: { color: c.ink, fontWeight: '900', marginTop: 16, marginBottom: 5 }, legalText: { color: c.muted, lineHeight: 21, marginTop: 6 }
  ,historyScoreAligned: { width: '32%', textAlign: 'center' },
  tipHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: 9, paddingBottom: 4 },
  tipHeaderName: { color: c.muted, width: '34%', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  tipHeaderValue: { color: c.muted, width: '32%', textAlign: 'center', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  tipHeaderPoints: { color: c.muted, width: '34%', textAlign: 'right', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  tipNameAligned: { flex: 0, width: '34%' },
  tipValueAligned: { minWidth: 0, width: '32%' },
  tipPointsAligned: { width: '34%' },
  tipNameColumn: { width: '34%' },
  tipValueColumn: { width: '32%', alignItems: 'center' },
  tipPointsColumn: { width: '34%', alignItems: 'flex-end' },
  historyToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderTopWidth: 1, borderTopColor: c.line, paddingVertical: 11, marginTop: 2 },
  historyToggleText: { color: c.lime, fontSize: 12, fontWeight: '800' },
  historyToggleArrow: { color: c.lime, fontSize: 11, fontWeight: '900' },
  liveSection: { marginBottom: 6 },
  liveSectionTitle: { color: '#ff5a52', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, marginBottom: 10 },
  liveCard: { borderColor: '#7a3138', backgroundColor: '#13223a' },
  liveMatch: { marginBottom: 0 },
  liveScoreBlock: { width: '32%', alignItems: 'center' },
  liveScore: { color: '#ff5a52', fontSize: 25, fontWeight: '900', textAlign: 'center' },
  liveMinute: { color: c.ink, fontSize: 11, fontWeight: '900', marginTop: 4, textAlign: 'center' },
  liveScoreLabel: { color: c.muted, fontSize: 8, fontWeight: '900', letterSpacing: .8, marginTop: 4, textAlign: 'center' },
  liveDetailsHint: { color: c.lime, fontSize: 11, fontWeight: '900', letterSpacing: .3, marginTop: 12, textAlign: 'center' },
  profileHint: { color: c.muted, fontSize: 11, lineHeight: 16, marginTop: 7 },
  authFeedback: { marginTop: 13, padding: 11, borderRadius: 9, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  authFeedbackError: { color: '#ffd4d4', backgroundColor: '#421c27' },
  authFeedbackSuccess: { color: c.lime, backgroundColor: '#183220' },
  passwordResetLink: { color: c.lime, textAlign: 'center', paddingTop: 18, fontWeight: '800' },
  authHelpLinks: { alignItems: 'center' },
  tableSaveFeedback: { color: c.lime, textAlign: 'center', marginTop: 12, fontSize: 12, fontWeight: '800', lineHeight: 18 },
  liveTableHeader: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line, paddingHorizontal: 8, paddingBottom: 7 },
  liveTableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: c.line, paddingVertical: 9, gap: 8 },
  liveTableRank: { color: c.muted, width: 20, textAlign: 'center', fontSize: 12, fontWeight: '900' },
  liveTableTeam: { color: c.ink, flex: 1, minWidth: 0, fontSize: 12, fontWeight: '800' },
  liveTableStats: { color: c.muted, width: 40, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  liveTablePoints: { color: c.lime, width: 24, textAlign: 'right', fontSize: 15, fontWeight: '900' },
  adminCard: { borderColor: '#607f2b' },
  adminLabel: { color: c.lime, fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginTop: 18, marginBottom: 8 },
  adminUserList: { gap: 8, paddingRight: 10 },
  adminUser: { borderWidth: 1, borderColor: c.line, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  adminUserActive: { backgroundColor: c.lime, borderColor: c.lime },
  adminUserText: { color: c.ink, fontSize: 12, fontWeight: '800' },
  adminUserTextActive: { color: c.bg },
  adminGame: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: 13, marginTop: 13 },
  adminGameDate: { color: c.muted, fontSize: 11, fontWeight: '800' },
  adminGameTeams: { color: c.ink, fontSize: 13, fontWeight: '800', marginTop: 3 },
  adminScoreRow: { alignItems: 'center', flexDirection: 'row', marginTop: 10 },
  adminSave: { backgroundColor: c.lime, borderRadius: 9, marginLeft: 10, paddingHorizontal: 11, paddingVertical: 11 },
  adminSaveText: { color: c.bg, fontSize: 11, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, .6)', justifyContent: 'flex-end' },
  modalSheet: { maxHeight: '88%', backgroundColor: c.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20 },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: c.ink, fontSize: 25, fontWeight: '900', marginTop: 3 },
  modalClose: { alignItems: 'center', backgroundColor: c.panel2, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  modalCloseText: { color: c.ink, fontSize: 26, fontWeight: '500', lineHeight: 29 },
  modalLoading: { marginTop: 30 },
  modalTips: { paddingBottom: 24 },
  modalSubtitle: { color: c.muted, fontSize: 14, fontWeight: '800', marginBottom: 12 },
  modalError: { color: c.red, fontSize: 14, fontWeight: '700', marginTop: 20 },
  modalRefreshing: { marginVertical: 8 },
  liveEvents: { paddingBottom: 24 },
  liveEvent: { alignItems: 'flex-start', borderBottomColor: c.line, borderBottomWidth: 1, flexDirection: 'row', gap: 10, paddingVertical: 13 },
  liveEventTime: { fontSize: 13, fontWeight: '900', paddingTop: 2, width: 42 },
  goalEvent: { color: c.lime },
  penaltyEvent: { color: '#ffb452' },
  liveEventMain: { flex: 1 },
  liveEventTitle: { color: c.ink, fontSize: 12, fontWeight: '900' },
  liveEventPlayer: { color: c.ink, fontSize: 15, fontWeight: '800', marginTop: 2 },
  liveEventDetail: { color: c.muted, fontSize: 12, marginTop: 2 },
  liveEventResult: { color: c.ink, fontSize: 13, fontWeight: '900', paddingTop: 2, textAlign: 'right', width: 55 },
  playerTipRow: { borderBottomColor: c.line, borderBottomWidth: 1, paddingVertical: 13 },
  playerTipDate: { color: c.muted, fontSize: 11, fontWeight: '800' },
  playerTipTeams: { color: c.ink, fontSize: 13, fontWeight: '800', marginTop: 3 },
  playerTipScores: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 8 },
  playerTipScore: { color: c.ink, fontSize: 12, fontWeight: '900' },
  playerTipActual: { color: c.muted, flex: 1, fontSize: 12, fontWeight: '800' },
  playerTipPoints: { color: c.lime, fontSize: 14, fontWeight: '900' },
  pointsSummary: { alignItems: 'center', backgroundColor: c.panel2, borderLeftColor: c.lime, borderLeftWidth: 4, borderRadius: 10, flexDirection: 'row', gap: 9, marginBottom: 9, paddingHorizontal: 13, paddingVertical: 10 },
  pointsSummaryCount: { color: c.lime, fontSize: 23, fontWeight: '900' },
  pointsSummaryLabel: { color: c.ink, fontSize: 13, fontWeight: '800' },
});
