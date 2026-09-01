export type AuthCallbackData =
  | { kind: 'signup'; accessToken: string | null; refreshToken: string | null; code: string | null }
  | { kind: 'recovery'; accessToken: string | null; refreshToken: string | null; code: string | null }
  | { kind: 'error'; errorCode: string | null }
  | null;

export function parseAuthCallback(value: string): AuthCallbackData {
  const url = new URL(value, 'https://oberliga-tippspiel.sued.workers.dev');
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  const error = hash.get('error') ?? query.get('error');
  if (error) return { kind: 'error', errorCode: hash.get('error_code') ?? query.get('error_code') };

  const type = hash.get('type') ?? query.get('type');
  const code = query.get('code');
  const recovery = type === 'recovery' || query.get('mode') === 'recovery';
  if (type !== 'signup' && !recovery && !code) return null;
  return {
    kind: recovery ? 'recovery' : 'signup',
    accessToken: hash.get('access_token'),
    refreshToken: hash.get('refresh_token'),
    code,
  };
}
