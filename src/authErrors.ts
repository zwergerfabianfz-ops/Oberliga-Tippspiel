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

export function registrationErrorMessage(error: AuthErrorLike): string {
  const message = error.message?.toLowerCase() ?? '';
  if (error.code === 'email_address_not_authorized' || message.includes('email address not authorized')) {
    return 'Die Bestätigungs-E-Mail konnte nicht versendet werden, weil der Mailversand der App noch nicht für externe Empfänger eingerichtet ist. Bitte melde dich beim Betreiber des Tippspiels.';
  }
  if (error.code === 'over_email_send_rate_limit' || message.includes('email rate limit') || message.includes('rate limit')) {
    return 'Das Versandlimit für Bestätigungs-E-Mails ist erreicht. Das Konto kann dabei bereits angelegt worden sein. Bitte später „Bestätigungs-E-Mail erneut senden“ verwenden.';
  }
  if (error.code === 'user_already_exists' || message.includes('user already registered')) {
    return 'Für diese E-Mail-Adresse existiert bereits ein Konto. Bitte einloggen oder die Bestätigungs-E-Mail erneut senden.';
  }
  return authErrorMessage(error);
}

export function withAuthTimeout<T>(operation: PromiseLike<T>, milliseconds = 15_000): Promise<T> {
  return Promise.race([
    Promise.resolve(operation),
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('Zeitüberschreitung')), milliseconds)),
  ]);
}
