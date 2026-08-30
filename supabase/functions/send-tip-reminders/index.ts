import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type UpcomingGame = { id: string; starts_at: string };
type WebPushSubscription = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
type SubscriptionRow = { user_id: string; endpoint: string; subscription: WebPushSubscription };

Deno.serve(async req => {
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  const expectedSecret = Deno.env.get('REMINDER_SECRET');
  if (!expectedSecret || req.headers.get('x-reminder-secret') !== expectedSecret) return response({ error: 'Unauthorized' }, 401);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return response({ error: 'VAPID-Schlüssel fehlen.' }, 500);
  webpush.setVapidDetails('mailto:fabian.zwerger@web.de', publicKey, privateKey);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = Date.now();
  const from = new Date(now + 55 * 60_000).toISOString();
  const until = new Date(now + 65 * 60_000).toISOString();
  const { data: games, error: gamesError } = await supabase.from('games')
    .select('id,starts_at').eq('is_final', false).gte('starts_at', from).lt('starts_at', until);
  if (gamesError) return response({ error: gamesError.message }, 500);
  if (!games?.length) return response({ sent: 0, reason: 'no-games-due' });

  const gameIds = games.map(game => game.id);
  const [{ data: subscriptions, error: subscriptionError }, { data: predictions }, { data: sentRows }] = await Promise.all([
    supabase.from('push_subscriptions').select('user_id,endpoint,subscription'),
    supabase.from('game_predictions').select('user_id,game_id').in('game_id', gameIds),
    supabase.from('sent_tip_reminders').select('user_id,game_id').in('game_id', gameIds),
  ]);
  if (subscriptionError) return response({ error: subscriptionError.message }, 500);

  const tipped = new Set((predictions ?? []).map(item => `${item.user_id}:${item.game_id}`));
  const alreadySent = new Set((sentRows ?? []).map(item => `${item.user_id}:${item.game_id}`));
  const successful = new Set<string>();
  let sent = 0;

  for (const subscription of (subscriptions ?? []) as SubscriptionRow[]) {
    const missing = (games as UpcomingGame[]).filter(game =>
      !tipped.has(`${subscription.user_id}:${game.id}`) && !alreadySent.has(`${subscription.user_id}:${game.id}`)
    );
    if (!missing.length) continue;
    const payload = JSON.stringify({
      title: 'Tipp nicht vergessen 🏒',
      body: missing.length === 1
        ? 'Ein Spiel beginnt in etwa einer Stunde und dein Tipp fehlt noch.'
        : `${missing.length} Spiele beginnen in etwa einer Stunde und deine Tipps fehlen noch.`,
      url: '/',
    });
    try {
      await webpush.sendNotification(subscription.subscription, payload, { TTL: 3600 });
      sent += 1;
      missing.forEach(game => successful.add(`${subscription.user_id}:${game.id}`));
    } catch (error) {
      const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      } else {
        console.error('Push notification failed', error);
      }
    }
  }

  if (successful.size) {
    const reminders = [...successful].map(key => {
      const separator = key.lastIndexOf(':');
      return { user_id: key.slice(0, separator), game_id: key.slice(separator + 1) };
    });
    const { error } = await supabase.from('sent_tip_reminders').upsert(reminders, { onConflict: 'user_id,game_id' });
    if (error) return response({ error: error.message, sent }, 500);
  }
  return response({ sent, gamesChecked: games.length });
});

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
