type AuthErrorLike = { code?: string; message?: string };

export function authErrorMessage(error: AuthErrorLike): string {
  if (error.code === 'email_not_confirmed' || error.message?.toLowerCase().includes('email not confirmed')) {
    return 'Die E-Mail-Adresse wurde noch nicht bestätigt. Bitte öffne zuerst den Bestätigungslink aus der Registrierungs-E-Mail.';
  }
  if (error.code === 'invalid_credentials' || error.message?.toLowerCase().includes('invalid login credentials')) {
    return 'E-Mail-Adresse oder Passwort ist nicht korrekt.';
  }
  if (error.code === 'over_request_rate_limit' || error.message?.toLowerCase().includes('rate limit')) {
    return 'Zu viele Anmeldeversuche. Bitte warte kurz und versuche es dann erneut.';
  }
  return error.message || 'Die Anmeldung ist fehlgeschlagen. Bitte versuche es erneut.';
}

export function withAuthTimeout<T>(operation: PromiseLike<T>, milliseconds = 15_000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), milliseconds)),
  ]);
}
