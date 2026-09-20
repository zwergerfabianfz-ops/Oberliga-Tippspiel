import { describe, expect, it } from 'vitest';
import { isOfficiallyLive } from './liveStatus';

describe('isOfficiallyLive', () => {
  it('does not show a premature live feed before the official start', () => {
    expect(isOfficiallyLive(true, '2026-09-20T13:00:00.000Z', new Date('2026-09-20T12:12:00.000Z').getTime())).toBe(false);
  });

  it('shows a live game once the official start has been reached', () => {
    expect(isOfficiallyLive(true, '2026-09-20T13:00:00.000Z', new Date('2026-09-20T13:00:00.000Z').getTime())).toBe(true);
  });
});
