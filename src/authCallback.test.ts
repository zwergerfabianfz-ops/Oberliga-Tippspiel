import { describe, expect, it } from 'vitest';
import { parseAuthCallback } from './authCallback';

describe('parseAuthCallback', () => {
  it('recognizes a successful implicit signup confirmation', () => {
    expect(parseAuthCallback('https://app.test/#access_token=access&refresh_token=refresh&type=signup')).toEqual({
      kind: 'signup', accessToken: 'access', refreshToken: 'refresh', code: null,
    });
  });

  it('recognizes a confirmation code callback', () => {
    expect(parseAuthCallback('https://app.test/?code=confirmation-code')).toEqual({
      kind: 'signup', accessToken: null, refreshToken: null, code: 'confirmation-code',
    });
  });

  it('recognizes an implicit password recovery callback', () => {
    expect(parseAuthCallback('https://app.test/#access_token=access&refresh_token=refresh&type=recovery')).toEqual({
      kind: 'recovery', accessToken: 'access', refreshToken: 'refresh', code: null,
    });
  });

  it('recognizes a password recovery code callback', () => {
    expect(parseAuthCallback('https://app.test/?mode=recovery&code=recovery-code')).toEqual({
      kind: 'recovery', accessToken: null, refreshToken: null, code: 'recovery-code',
    });
  });

  it('recognizes an expired confirmation link', () => {
    expect(parseAuthCallback('https://app.test/#error=access_denied&error_code=otp_expired')).toEqual({
      kind: 'error', errorCode: 'otp_expired',
    });
  });

  it('ignores a normal app URL', () => {
    expect(parseAuthCallback('https://app.test/')).toBeNull();
  });
});
