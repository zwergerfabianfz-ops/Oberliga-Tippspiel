import { Platform } from 'react-native';
import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = 'BMtms_bhQHUTft5lkZ-zN75Edpdz25hcnnmGa1lqOSbnN-ITfz3qdLuRDwjTVv6jSFzZbmAgNi5iSJBeQ1l57iA';

export function pushNotificationsSupported(): boolean {
  return Platform.OS === 'web'
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function pushNotificationsEnabled(): Promise<boolean> {
  if (!pushNotificationsSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  return Boolean(await registration.pushManager.getSubscription());
}

export async function enablePushNotifications(userId: string): Promise<void> {
  if (!pushNotificationsSupported()) throw new Error('Benachrichtigungen werden auf diesem Gerät nicht unterstützt.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Benachrichtigungen wurden nicht erlaubt.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: userId,
    endpoint: subscription.endpoint,
    subscription: subscription.toJSON(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePushNotifications(): Promise<void> {
  if (!pushNotificationsSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
}

function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64);
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}
