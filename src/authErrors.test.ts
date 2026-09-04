import { describe, expect, it, vi } from 'vitest';
import { authErrorMessage, registrationErrorMessage, withAuthTimeout } from './authErrors';

describe('authErrorMessage', () => {
  it('translates common login errors', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toContain('noch nicht bestätigt');
    expect(authErrorMessage({ code: 'invalid_credentials' })).toContain('nicht korrekt');
    expect(authErrorMessage({ code: 'over_request_rate_limit' })).toContain('Zu viele');
  });
});

describe('registrationErrorMessage', () => {
  it('explains SMTP and confirmation mail failures', () => {
    expect(registrationErrorMessage({ code: 'email_address_not_authorized' })).toContain('Mailversand');
    expect(registrationErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('Versandlimit');
    expect(registrationErrorMessage({ code: 'user_already_exists' })).toContain('bereits ein Konto');
  });
});

describe('withAuthTimeout', () => {
  it('rejects an operation that does not answer', async () => {
    vi.useFakeTimers();
    const result = withAuthTimeout(new Promise<string>(() => undefined), 100);
    const assertion = expect(result).rejects.toThrow('Zeitüberschreitung');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    vi.useRealTimers();
  });
});
