export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function displayNameValidationError(value: string): string | null {
  const normalized = normalizeDisplayName(value);
  if (normalized.length < 2) return 'Der Anzeigename muss mindestens 2 Zeichen lang sein.';
  if (normalized.length > 30) return 'Der Anzeigename darf höchstens 30 Zeichen lang sein.';
  return null;
}
