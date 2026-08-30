const pageUrl = 'https://deb-online.live/liga/herren/oberliga-sued/';
const divisionId = process.argv[2] ?? '21614';
const seasonName = process.argv[3] ?? 'Oberliga Süd 2026/27';
const deadline = process.argv[4] ?? '2026-09-17T21:59:59.000Z';

const htmlResponse = await fetch(pageUrl);
if (!htmlResponse.ok) throw new Error(`DEB-Seite antwortet mit HTTP ${htmlResponse.status}`);
const html = await htmlResponse.text();
const apiKey = html.match(/&quot;apiKey&quot;:&quot;([^&]+)&quot;/)?.[1]
  ?? html.match(/"apiKey":"([^"]+)"/)?.[1];
if (!apiKey) throw new Error('Kein HockeyData-Key auf der DEB-Seite gefunden.');

const endpoint = new URL('https://api.hockeydata.net/data/ebel/Schedule');
endpoint.searchParams.set('apiKey', apiKey);
endpoint.searchParams.set('referer', 'deb-online.live');
endpoint.searchParams.set('lang', 'de');
endpoint.searchParams.set('divisionId', divisionId);
endpoint.searchParams.set('widgetOptions', JSON.stringify({ semantic: true, noScorers: true }));
const scheduleResponse = await fetch(endpoint);
const payload = await scheduleResponse.json();
if (!scheduleResponse.ok || payload.statusId <= 0) throw new Error(payload.statusMsg ?? 'HockeyData-Abruf fehlgeschlagen.');

const rows = payload.data?.rows ?? [];
if (rows.length < 100) throw new Error(`Nur ${rows.length} Spiele gefunden; Seed wird nicht erzeugt.`);

const teamsById = new Map();
for (const row of rows) {
  teamsById.set(String(row.homeTeamId), team(row.homeTeamId, row.homeTeamLongName, row.homeTeamShortName));
  teamsById.set(String(row.awayTeamId), team(row.awayTeamId, row.awayTeamLongName, row.awayTeamShortName));
}
const teams = [...teamsById.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
const games = rows.map(row => {
  const isFinal = row.gameHasEnded === true || [3, 4].includes(row.gameStatus ?? 0);
  return {
    external_id: String(row.id), phase: 'regular', starts_at: new Date(row.gameUtcTimestamp).toISOString(),
    matchday: row.gameDay ?? null,
    home_external_id: String(row.homeTeamId), away_external_id: String(row.awayTeamId),
    home_score: isFinal ? row.homeTeamScore : null, away_score: isFinal ? row.awayTeamScore : null,
    is_final: isFinal,
  };
});

if (teams.length !== 14 || games.length !== 364) throw new Error(`Unerwarteter Umfang: ${teams.length} Teams, ${games.length} Spiele.`);

const sql = `-- Automatisch aus ${pageUrl} erzeugt.
-- ${teams.length} Teams, ${games.length} Hauptrundenspiele; Playoffs werden noch nicht angelegt.
begin;

insert into public.seasons (name, external_division_id, table_prediction_deadline, status)
values (${literal(seasonName)}, ${literal(divisionId)}, ${literal(deadline)}::timestamptz, 'upcoming')
on conflict (external_division_id) do update set
  name = excluded.name,
  table_prediction_deadline = excluded.table_prediction_deadline;

with current_season as (
  select id from public.seasons where external_division_id = ${literal(divisionId)}
), payload as (
  select * from jsonb_to_recordset($teams$${JSON.stringify(teams)}$teams$::jsonb)
    as x(external_id text, name text, short_name text, logo_url text)
)
insert into public.teams (season_id, external_id, name, short_name, logo_url)
select current_season.id, payload.external_id, payload.name, payload.short_name, payload.logo_url
from current_season cross join payload
on conflict (season_id, external_id) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  logo_url = excluded.logo_url;

with current_season as (
  select id from public.seasons where external_division_id = ${literal(divisionId)}
), payload as (
  select * from jsonb_to_recordset($games$${JSON.stringify(games)}$games$::jsonb)
    as x(external_id text, phase text, starts_at timestamptz, matchday smallint, home_external_id text,
      away_external_id text, home_score smallint, away_score smallint, is_final boolean)
)
insert into public.games (season_id, external_id, phase, starts_at, matchday, home_team_id, away_team_id,
  home_score, away_score, is_final, updated_at)
select current_season.id, payload.external_id, payload.phase::public.game_phase, payload.starts_at,
  payload.matchday, home.id, away.id, payload.home_score, payload.away_score, payload.is_final, now()
from current_season cross join payload
join public.teams home on home.season_id = current_season.id and home.external_id = payload.home_external_id
join public.teams away on away.season_id = current_season.id and away.external_id = payload.away_external_id
on conflict (season_id, external_id) do update set
  phase = excluded.phase,
  starts_at = excluded.starts_at,
  matchday = excluded.matchday,
  home_team_id = excluded.home_team_id,
  away_team_id = excluded.away_team_id,
  home_score = excluded.home_score,
  away_score = excluded.away_score,
  is_final = excluded.is_final,
  updated_at = now();

commit;
`;
process.stdout.write(sql);

function team(id, name, shortName) {
  return {
    external_id: String(id), name, short_name: shortName,
    logo_url: `https://api.hockeydata.net/img/icehockey/ebel/team-logos/${divisionId}/${id}.png`,
  };
}
function literal(value) { return `'${String(value).replaceAll("'", "''")}'`; }
