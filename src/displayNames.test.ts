import { describe, expect, it } from 'vitest';
import { displayNameValidationError, normalizeDisplayName } from './displayNames';

describe('normalizeDisplayName', () => {
  it('trims the name and collapses whitespace', () => {
    expect(normalizeDisplayName('  Fabian   Zwerger  ')).toBe('Fabian Zwerger');
  });
});

describe('displayNameValidationError', () => {
  it('accepts names between 2 and 30 normalized characters', () => {
    expect(displayNameValidationError('Fabian')).toBeNull();
    expect(displayNameValidationError(' A ')).not.toBeNull();
    expect(displayNameValidationError('a'.repeat(31))).not.toBeNull();
  });
});
