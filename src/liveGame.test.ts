import { describe, expect, it } from 'vitest';
import { liveClockLabel } from './liveGame';

describe('liveClockLabel', () => {
  it('converts HockeyData elapsed seconds to the current game minute', () => {
    expect(liveClockLabel(1, '1ST PERIOD')).toBe('1. Minute');
    expect(liveClockLabel(1250, '2ND PERIOD')).toBe('21. Minute');
    expect(liveClockLabel(2400, '2ND INTERMISSION')).toBe('Pause nach 40. Minute');
  });

  it('labels overtime and shootout', () => {
    expect(liveClockLabel(3661, 'OVERTIME')).toBe('62. Minute · Verlängerung');
    expect(liveClockLabel(3600, 'SHOOTOUT')).toBe('Penaltyschießen');
  });

  it('falls back when HockeyData has no clock value', () => {
    expect(liveClockLabel(null, null)).toBe('Spiel läuft');
  });
});
