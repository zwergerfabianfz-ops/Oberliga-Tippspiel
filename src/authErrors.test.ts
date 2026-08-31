import { describe, expect, it, vi } from 'vitest';
import { authErrorMessage, withAuthTimeout } from './authErrors';

describe('authErrorMessage', () => {
  it('translates common login errors', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toContain('noch nicht bestätigt');
    expect(authErrorMessage({ code: 'invalid_credentials' })).toContain('nicht korrekt');
    expect(authErrorMessage({ code: 'over_request_rate_limit' })).toContain('Zu viele');
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
