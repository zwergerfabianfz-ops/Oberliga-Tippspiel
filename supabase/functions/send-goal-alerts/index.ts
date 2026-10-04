import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type LiveGame = { id: string; home_team_id: string; away_team_id: string; home_score: number; away_score: number };
type GoalState = { game_id: string; home_score: number; away_score: number };
type Subscription = { endpoint: string; subscription: { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } } };

Deno.serve(async req => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const expectedSecret = Deno.env.get('REMINDER_SECRET');
  if (!expectedSecret || req.headers.get('x-reminder-secret') !== expectedSecret) return response({ error: 'Unauthorized' }, 401);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return response({ error: 'VAPID-Schlüssel fehlen.' }, 500);
  webpush.setVapidDetails('mailto:fabian.zwerger@web.de', publicKey, privateKey);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: games, error: gamesError } = await supabase.from('games')
    .select('id,home_team_id,away_team_id,home_score,away_score')
    .eq('is_live', true)
    .not('home_score', 'is', null)
    .not('away_score', 'is', null);
  if (gamesError) return response({ error: gamesError.message }, 500);
  if (!games?.length) return response({ sent: 0, reason: 'no-live-games' });

  const liveGames = games as LiveGame[];
  const gameIds = liveGames.map(game => game.id);
  const teamIds = [...new Set(liveGames.flatMap(game => [game.home_team_id, game.away_team_id]))];
  const [{ data: states, error: statesError }, { data: teams, error: teamsError }] = await Promise.all([
    supabase.from('goal_alert_states').select('game_id,home_score,away_score').in('game_id', gameIds),
    supabase.from('teams').select('id,name').in('id', teamIds),
  ]);
  if (statesError || teamsError) return response({ error: statesError?.message ?? teamsError?.message }, 500);
  const stateByGame = new Map((states ?? []).map(state => [state.game_id, state as GoalState]));
  const teamName = new Map((teams ?? []).map(team => [team.id, team.name]));
  const changes = liveGames.flatMap(game => {
    const previous = stateByGame.get(game.id);
    if (!previous) return [];
    // Alle Fans eines beteiligten Teams werden benachrichtigt. Damit kommt
    // sowohl ein Tor des Lieblingsteams als auch ein Gegentor als Toralarm an.
    const result: { involvedTeamIds: string[]; title: string; body: string }[] = [];
    const homeGoals = game.home_score - previous.home_score;
    const awayGoals = game.away_score - previous.away_score;
    const home = teamName.get(game.home_team_id) ?? 'Heimteam';
    const away = teamName.get(game.away_team_id) ?? 'Gastteam';
    if (homeGoals > 0) result.push({ involvedTeamIds: [game.home_team_id, game.away_team_id], title: `Tor für ${home}! 🏒`, body: `${home} – ${away} ${game.home_score}:${game.away_score}` });
    if (awayGoals > 0) result.push({ involvedTeamIds: [game.home_team_id, game.away_team_id], title: `Tor für ${away}! 🏒`, body: `${home} – ${away} ${game.home_score}:${game.away_score}` });
    return result;
  });

  const snapshots = liveGames.map(game => ({ game_id: game.id, home_score: game.home_score, away_score: game.away_score, updated_at: new Date().toISOString() }));
  const { error: snapshotError } = await supabase.from('goal_alert_states').upsert(snapshots, { onConflict: 'game_id' });
  if (snapshotError) return response({ error: snapshotError.message }, 500);
  if (!changes.length) return response({ sent: 0, reason: 'baseline-or-no-new-goals' });

  const favoriteTeamIds = [...new Set(changes.flatMap(change => change.involvedTeamIds))];
  const { data: fans, error: fansError } = await supabase.from('profiles').select('id,favorite_team_id').in('favorite_team_id', favoriteTeamIds);
  if (fansError) return response({ error: fansError.message }, 500);
  const fanTeamByUser = new Map((fans ?? []).map(fan => [fan.id, fan.favorite_team_id]));
  if (!fanTeamByUser.size) return response({ sent: 0, reason: 'no-fans' });
  const { data: subscriptions, error: subscriptionsError } = await supabase.from('push_subscriptions').select('endpoint,subscription,user_id').in('user_id', [...fanTeamByUser.keys()]);
  if (subscriptionsError) return response({ error: subscriptionsError.message }, 500);

  let sent = 0;
  for (const row of subscriptions ?? []) {
    const relevantChanges = changes.filter(item => item.involvedTeamIds.includes(fanTeamByUser.get(row.user_id) ?? ''));
    for (const change of relevantChanges) {
      try {
        await webpush.sendNotification((row as Subscription).subscription, JSON.stringify({ title: change.title, body: change.body, url: '/' }), { TTL: 3600 });
        sent += 1;
      } catch (error) {
        const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
        if (statusCode === 404 || statusCode === 410) await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        else console.error('Goal alert failed', error);
      }
    }
  }
  return response({ sent, changes: changes.length });
});

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
