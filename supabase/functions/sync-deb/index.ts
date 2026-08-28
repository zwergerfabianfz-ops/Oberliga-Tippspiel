import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type HockeyDataRow = {
  gameId: number | string;
  scheduledDate: { value: string } | string;
  scheduledTime?: string;
  homeTeamId: number | string;
  homeTeamLongName: string;
  homeTeamShortName: string;
  awayTeamId: number | string;
  awayTeamLongName: string;
  awayTeamShortName: string;
  homeTeamScore?: number | null;
  awayTeamScore?: number | null;
  gameStatus?: number;
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (req.headers.get('Authorization') !== `Bearer ${Deno.env.get('SYNC_SECRET')}`) return new Response('Unauthorized', { status: 401 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: season, error: seasonError } = await supabase.from('seasons').select('*').order('created_at', { ascending: false }).limit(1).single();
  if (seasonError) return json({ error: seasonError.message }, 500);

  const apiKey = Deno.env.get('HOCKEYDATA_API_KEY');
  if (!apiKey) return json({ error: 'HOCKEYDATA_API_KEY fehlt. Zugang beim Datenanbieter/DEB klären.' }, 503);
  const options = JSON.stringify({ semantic: true, noScorers: true });
  const endpoint = new URL('https://api.hockeydata.net/data/ebel/Schedule');
  endpoint.searchParams.set('apiKey', apiKey);
  endpoint.searchParams.set('divisionId', season.external_division_id);
  endpoint.searchParams.set('widgetOptions', options);
  const response = await fetch(endpoint);
  const payload = await response.json();
  if (!response.ok || payload.statusId <= 0) return json({ error: payload.statusMsg ?? 'DEB/HockeyData-Abruf fehlgeschlagen' }, 502);

  const rows: HockeyDataRow[] = payload.data?.rows ?? [];
  const externalTeams = new Map<string, { external_id: string; name: string; short_name: string }>();
  for (const row of rows) {
    externalTeams.set(String(row.homeTeamId), { external_id: String(row.homeTeamId), name: row.homeTeamLongName, short_name: row.homeTeamShortName });
    externalTeams.set(String(row.awayTeamId), { external_id: String(row.awayTeamId), name: row.awayTeamLongName, short_name: row.awayTeamShortName });
  }
  const teams = [...externalTeams.values()].map(team => ({ ...team, season_id: season.id }));
  const { error: teamError } = await supabase.from('teams').upsert(teams, { onConflict: 'season_id,external_id' });
  if (teamError) return json({ error: teamError.message }, 500);
  const { data: storedTeams } = await supabase.from('teams').select('id,external_id').eq('season_id', season.id);
  const teamIds = new Map(storedTeams?.map(t => [t.external_id, t.id]));

  const games = rows.map(row => ({
    season_id: season.id,
    external_id: String(row.gameId),
    phase: season.playoffs_start_at && new Date(toIso(row.scheduledDate, row.scheduledTime)) >= new Date(season.playoffs_start_at) ? 'playoffs' : 'regular',
    starts_at: toIso(row.scheduledDate, row.scheduledTime),
    home_team_id: teamIds.get(String(row.homeTeamId)),
    away_team_id: teamIds.get(String(row.awayTeamId)),
    home_score: row.homeTeamScore ?? null,
    away_score: row.awayTeamScore ?? null,
    is_final: [3, 4].includes(row.gameStatus ?? 0),
    updated_at: new Date().toISOString(),
  }));
  const { error: gameError } = await supabase.from('games').upsert(games, { onConflict: 'season_id,external_id' });
  if (gameError) return json({ error: gameError.message }, 500);
  return json({ importedGames: games.length, importedTeams: teams.length });
});

function toIso(date: HockeyDataRow['scheduledDate'], time = '00:00') {
  const raw = typeof date === 'string' ? date : date.value;
  if (raw.includes('T')) return new Date(raw).toISOString();
  const [day, month, year] = raw.split('.');
  return new Date(`${year}-${month}-${day}T${time}:00+02:00`).toISOString();
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: cors }); }
