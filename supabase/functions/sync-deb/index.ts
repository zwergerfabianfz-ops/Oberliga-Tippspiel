import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type HockeyDataRow = {
  id: string;
  gameUtcTimestamp: number;
  gameDay?: number | null;
  gameName?: string | null;
  homeTeamId: number | string;
  homeTeamLongName: string;
  homeTeamShortName: string;
  homeTeamLogoUrl?: string | null;
  awayTeamId: number | string;
  awayTeamLongName: string;
  awayTeamShortName: string;
  awayTeamLogoUrl?: string | null;
  homeTeamScore?: number | null;
  awayTeamScore?: number | null;
  gameStatus?: number;
  gameHasEnded?: boolean;
  liveTime?: number | null;
  liveTimeGamePhase?: string | null;
};

type HockeyDataStanding = {
  id: number | string;
  tableRank: number;
  gamesPlayed?: number;
  gamesWon?: number;
  gamesWonInOt?: number;
  gamesLost?: number;
  gamesLostInOt?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference?: string | number;
  points?: number;
};

type HockeyDataPlayer = { playerFirstname?: string; playerLastname?: string; playerJerseyNr?: number | null };
type HockeyDataGameReport = {
  homeGoals?: HockeyDataGoal[];
  awayGoals?: HockeyDataGoal[];
  homePenalties?: HockeyDataPenalty[];
  awayPenalties?: HockeyDataPenalty[];
};
type HockeyDataGoal = { guid: string; gameTime?: number; gameTimeFormatted?: string; gameTimePeriod?: string; scoredBy?: HockeyDataPlayer | null; assistBy?: HockeyDataPlayer | null; assist2By?: HockeyDataPlayer | null; newScore?: string; gameStrength?: string | null };
type HockeyDataPenalty = { guid: string; gameTime?: number; gameTimeFormatted?: string; gameTimePeriod?: string; offender?: HockeyDataPlayer | null; offence?: string | null; penaltyLength?: number | null };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const PRESEASON_DIVISION_ID = 'deb_ol_fs';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let requestedGameId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.gameId === 'string') requestedGameId = body.gameId;
  } catch { /* The regular sync has no request body. */ }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const authorization = req.headers.get('Authorization') ?? '';
  const isTrustedSync = Boolean(Deno.env.get('SYNC_SECRET')) && authorization === `Bearer ${Deno.env.get('SYNC_SECRET')}`;
  if (!isTrustedSync) {
    const token = authorization.replace(/^Bearer\s+/i, '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return new Response('Unauthorized', { status: 401, headers: cors });
  }

  const { data: season, error: seasonError } = await supabase.from('seasons').select('*').order('created_at', { ascending: false }).limit(1).single();
  if (seasonError) return json({ error: seasonError.message }, 500);

  const [{ data: latestGame }, { count: preseasonCount }] = await Promise.all([
    supabase.from('games').select('updated_at').eq('season_id', season.id).order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('games').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('is_preseason', true),
  ]);
  if (!requestedGameId && (preseasonCount ?? 0) > 0 && latestGame && Date.now() - new Date(latestGame.updated_at).getTime() < 12_000) {
    return json({ skipped: true, reason: 'recently-synced' });
  }

  const apiKey = Deno.env.get('HOCKEYDATA_API_KEY') ?? await discoverPublicApiKey();
  if (!apiKey) return json({ error: 'Kein HockeyData-Key auf der DEB-Seite gefunden.' }, 503);
  if (requestedGameId) {
    try {
      const isPreseasonRequest = requestedGameId.startsWith('preseason:');
      const divisionId = isPreseasonRequest ? PRESEASON_DIVISION_ID : season.external_division_id;
      const hockeyDataGameId = isPreseasonRequest ? requestedGameId.slice('preseason:'.length) : requestedGameId;
      const schedule = await fetchSchedule(apiKey, divisionId);
      const game = schedule.find(row => row.id === hockeyDataGameId);
      if (!game) return json({ error: 'Spiel nicht gefunden.' }, 404);
      const report = await fetchGameReport(apiKey, divisionId, hockeyDataGameId);
      return json({ gameId: requestedGameId, events: gameEvents(report) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Spielbericht konnte nicht geladen werden.' }, 502);
    }
  }
  let rows: HockeyDataRow[];
  let preseasonRows: HockeyDataRow[];
  let standings: HockeyDataStanding[];
  try {
    [rows, preseasonRows, standings] = await Promise.all([
      fetchSchedule(apiKey, season.external_division_id),
      fetchSchedule(apiKey, PRESEASON_DIVISION_ID),
      fetchStandings(apiKey, season.external_division_id),
    ]);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'DEB/HockeyData-Abruf fehlgeschlagen' }, 502);
  }
  if (rows.length < 100) return json({ error: `Unvollständiger DEB-Spielplan (${rows.length} Spiele). Import abgebrochen.` }, 502);
  const externalTeams = new Map<string, { external_id: string; name: string; short_name: string; logo_url: string | null; is_competitor: boolean }>();
  const competitorIdByName = new Map<string, string>();
  for (const row of rows) {
    for (const team of rowTeams(row)) {
      const externalId = String(team.id);
      const name = canonicalTeamName(team.name);
      competitorIdByName.set(name, externalId);
      externalTeams.set(externalId, { external_id: externalId, name, short_name: team.shortName, logo_url: logoUrl(season.external_division_id, team.id), is_competitor: true });
    }
  }
  const relevantPreseasonRows = preseasonRows.filter(row =>
    competitorIdByName.has(canonicalTeamName(row.homeTeamLongName)) || competitorIdByName.has(canonicalTeamName(row.awayTeamLongName))
  );
  for (const row of relevantPreseasonRows) {
    for (const team of rowTeams(row)) {
      const name = canonicalTeamName(team.name);
      if (competitorIdByName.has(name)) continue;
      const externalId = `preseason:${team.id}`;
      externalTeams.set(externalId, { external_id: externalId, name, short_name: team.shortName, logo_url: cleanLogoUrl(team.logoUrl) ?? genericLogoUrl(team.id), is_competitor: false });
    }
  }
  const teams = [...externalTeams.values()].map(team => ({ ...team, season_id: season.id }));
  const { error: teamError } = await supabase.from('teams').upsert(teams, { onConflict: 'season_id,external_id' });
  if (teamError) return json({ error: teamError.message }, 500);
  const { data: storedTeams } = await supabase.from('teams').select('id,external_id').eq('season_id', season.id);
  const teamIds = new Map(storedTeams?.map(t => [t.external_id, t.id]));
  const standingRows = standings.flatMap(row => {
    const teamId = teamIds.get(String(row.id));
    if (!teamId || !Number.isInteger(row.tableRank) || row.tableRank < 1) return [];
    return [{
      season_id: season.id,
      team_id: teamId,
      position: row.tableRank,
      games_played: row.gamesPlayed ?? 0,
      wins: (row.gamesWon ?? 0) + (row.gamesWonInOt ?? 0),
      losses: (row.gamesLost ?? 0) + (row.gamesLostInOt ?? 0),
      goals_for: row.goalsFor ?? 0,
      goals_against: row.goalsAgainst ?? 0,
      goal_difference: Number(row.goalDifference ?? 0),
      points: row.points ?? 0,
      updated_at: new Date().toISOString(),
    }];
  });
  if (standingRows.length) {
    const { error: standingError } = await supabase.from('team_standings').upsert(standingRows, { onConflict: 'season_id,team_id' });
    if (standingError) return json({ error: standingError.message }, 500);
  }

  const games = rows.map(row => {
    const isFinal = row.gameHasEnded === true || [3, 4].includes(row.gameStatus ?? 0);
    const isLive = !isFinal && row.gameUtcTimestamp <= Date.now() && [1, 2].includes(row.gameStatus ?? 0);
    return {
      season_id: season.id,
      external_id: row.id,
      phase: season.playoffs_start_at && row.gameUtcTimestamp >= new Date(season.playoffs_start_at).getTime() ? 'playoffs' : 'regular',
      matchday: officialMatchday(row),
      starts_at: new Date(row.gameUtcTimestamp).toISOString(),
      home_team_id: teamIds.get(String(row.homeTeamId)),
      away_team_id: teamIds.get(String(row.awayTeamId)),
      home_score: isLive || isFinal ? row.homeTeamScore ?? 0 : null,
      away_score: isLive || isFinal ? row.awayTeamScore ?? 0 : null,
      is_live: isLive,
      is_final: isFinal,
      live_elapsed_seconds: isLive && typeof row.liveTime === 'number' ? Math.max(0, Math.round(row.liveTime)) : null,
      live_phase: isLive ? row.liveTimeGamePhase ?? null : null,
      is_preseason: false,
      updated_at: new Date().toISOString(),
    };
  });
  const preseasonGames = relevantPreseasonRows.map(row => {
    const isFinal = row.gameHasEnded === true || [3, 4].includes(row.gameStatus ?? 0);
    const isLive = !isFinal && row.gameUtcTimestamp <= Date.now() && [1, 2].includes(row.gameStatus ?? 0);
    return {
      season_id: season.id,
      external_id: `preseason:${row.id}`,
      phase: 'regular',
      matchday: null,
      starts_at: new Date(row.gameUtcTimestamp).toISOString(),
      home_team_id: teamIds.get(preseasonTeamExternalId(row.homeTeamLongName, row.homeTeamId, competitorIdByName)),
      away_team_id: teamIds.get(preseasonTeamExternalId(row.awayTeamLongName, row.awayTeamId, competitorIdByName)),
      home_score: isLive || isFinal ? row.homeTeamScore ?? 0 : null,
      away_score: isLive || isFinal ? row.awayTeamScore ?? 0 : null,
      is_live: isLive,
      is_final: isFinal,
      live_elapsed_seconds: isLive && typeof row.liveTime === 'number' ? Math.max(0, Math.round(row.liveTime)) : null,
      live_phase: isLive ? row.liveTimeGamePhase ?? null : null,
      is_preseason: true,
      updated_at: new Date().toISOString(),
    };
  });
  games.push(...preseasonGames);
  const { error: gameError } = await supabase.from('games').upsert(games, { onConflict: 'season_id,external_id' });
  if (gameError) return json({ error: gameError.message }, 500);
  return json({ importedGames: games.length, importedPreseasonGames: preseasonGames.length, importedTeams: teams.length, importedStandings: standingRows.length, liveGames: games.filter(game => game.is_live).length });
});

async function fetchSchedule(apiKey: string, divisionId: string): Promise<HockeyDataRow[]> {
  const endpoint = new URL('https://api.hockeydata.net/data/ebel/Schedule');
  endpoint.searchParams.set('apiKey', apiKey);
  endpoint.searchParams.set('referer', 'deb-online.live');
  endpoint.searchParams.set('lang', 'de');
  endpoint.searchParams.set('divisionId', divisionId);
  endpoint.searchParams.set('widgetOptions', JSON.stringify({ semantic: true, noScorers: true }));
  const response = await fetch(endpoint);
  const payload = await response.json();
  if (!response.ok || payload.statusId <= 0) throw new Error(payload.statusMsg ?? `Abruf für ${divisionId} fehlgeschlagen`);
  return payload.data?.rows ?? [];
}

async function fetchStandings(apiKey: string, divisionId: string): Promise<HockeyDataStanding[]> {
  const endpoint = new URL('https://api.hockeydata.net/data/ebel/Standings');
  endpoint.searchParams.set('apiKey', apiKey);
  endpoint.searchParams.set('referer', 'deb-online.live');
  endpoint.searchParams.set('lang', 'de');
  endpoint.searchParams.set('divisionId', divisionId);
  endpoint.searchParams.set('widgetOptions', JSON.stringify({ semantic: true }));
  const response = await fetch(endpoint);
  const payload = await response.json();
  if (!response.ok || payload.statusId <= 0) throw new Error(payload.statusMsg ?? `Tabellenabruf für ${divisionId} fehlgeschlagen`);
  return payload.data?.rows ?? [];
}

async function fetchGameReport(apiKey: string, divisionId: string, gameId: string): Promise<HockeyDataGameReport> {
  const endpoint = new URL('https://api.hockeydata.net/data/ebel/GetGameReport');
  endpoint.searchParams.set('apiKey', apiKey);
  endpoint.searchParams.set('referer', 'deb-online.live');
  endpoint.searchParams.set('lang', 'de');
  endpoint.searchParams.set('divisionId', divisionId);
  endpoint.searchParams.set('gameId', gameId);
  endpoint.searchParams.set('widgetOptions', JSON.stringify({ semantic: true }));
  const response = await fetch(endpoint);
  const payload = await response.json();
  if (!response.ok || payload.statusId <= 0) throw new Error(payload.statusMsg ?? 'Spielbericht konnte nicht geladen werden.');
  return payload.data ?? {};
}

function gameEvents(report: HockeyDataGameReport) {
  const goals = (items: HockeyDataGoal[] | undefined, team: 'home' | 'away') => (items ?? []).map(item => ({
    id: item.guid, type: 'goal', team, seconds: item.gameTime ?? 0, time: item.gameTimeFormatted ?? '–', period: item.gameTimePeriod ?? '',
    player: playerName(item.scoredBy), score: item.newScore ?? '', detail: [playerName(item.assistBy), playerName(item.assist2By)].filter(Boolean).join(', '), strength: item.gameStrength ?? '',
  }));
  const penalties = (items: HockeyDataPenalty[] | undefined, team: 'home' | 'away') => (items ?? []).map(item => ({
    id: item.guid, type: 'penalty', team, seconds: item.gameTime ?? 0, time: item.gameTimeFormatted ?? '–', period: item.gameTimePeriod ?? '',
    player: playerName(item.offender), score: '', detail: item.offence ?? 'Strafe', strength: item.penaltyLength ? `${Math.round(item.penaltyLength / 60)} Min.` : '',
  }));
  return [...goals(report.homeGoals, 'home'), ...goals(report.awayGoals, 'away'), ...penalties(report.homePenalties, 'home'), ...penalties(report.awayPenalties, 'away')]
    .sort((a, b) => a.seconds - b.seconds);
}

function playerName(player?: HockeyDataPlayer | null) {
  if (!player) return '';
  const name = [player.playerFirstname, player.playerLastname].filter(Boolean).join(' ');
  return player.playerJerseyNr ? `#${player.playerJerseyNr} ${name}` : name;
}

async function discoverPublicApiKey() {
  const response = await fetch('https://deb-online.live/liga/herren/oberliga-sued/');
  if (!response.ok) return null;
  const html = await response.text();
  return html.match(/&quot;apiKey&quot;:&quot;([^&]+)&quot;/)?.[1]
    ?? html.match(/"apiKey":"([^"]+)"/)?.[1]
    ?? null;
}
function logoUrl(divisionId: string, teamId: string | number) { return `https://api.hockeydata.net/img/icehockey/ebel/team-logos/${divisionId}/${teamId}.png`; }
function genericLogoUrl(teamId: string | number) { return `https://api.hockeydata.net/img/icehockey/ebel/team-logos/${teamId}.png`; }
function cleanLogoUrl(value?: string | null) { return value?.replace('api.hockeydata.net//', 'api.hockeydata.net/') ?? null; }
function canonicalTeamName(name: string) { return name === 'Höchstadter EC' ? 'Höchstadt Alligators' : name; }
function officialMatchday(row: HockeyDataRow) {
  const gameNumber = Number(row.gameName?.match(/_(\d+)$/)?.[1]);
  return Number.isInteger(gameNumber) && gameNumber > 0 ? Math.ceil(gameNumber / 7) : row.gameDay ?? null;
}
function preseasonTeamExternalId(name: string, id: string | number, competitorIdByName: Map<string, string>) {
  return competitorIdByName.get(canonicalTeamName(name)) ?? `preseason:${id}`;
}
function rowTeams(row: HockeyDataRow) {
  return [
    { id: row.homeTeamId, name: row.homeTeamLongName, shortName: row.homeTeamShortName, logoUrl: row.homeTeamLogoUrl },
    { id: row.awayTeamId, name: row.awayTeamLongName, shortName: row.awayTeamShortName, logoUrl: row.awayTeamLogoUrl },
  ];
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: cors }); }
