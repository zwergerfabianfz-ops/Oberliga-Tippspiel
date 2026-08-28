import { describe, expect, it } from 'vitest';
import { isTipOpen, scoreGameTip, scoreTablePosition } from './scoring';

describe('scoreGameTip', () => {
  it.each([
    [4, 2, 4, 2, 3],
    [3, 1, 4, 2, 2],
    [5, 2, 2, 1, 1],
    [1, 3, 4, 2, 0],
  ])('wertet %i:%i gegen %i:%i mit %i Punkten', (ph, pa, ah, aa, score) => {
    expect(scoreGameTip(ph, pa, ah, aa)).toBe(score);
  });
});

describe('scoreTablePosition', () => {
  it('vergibt bei 13 Teams 13 Punkte für den exakten Platz', () => {
    expect(scoreTablePosition(4, 4, 13)).toBe(13);
    expect(scoreTablePosition(4, 6, 13)).toBe(11);
  });
});

it('sperrt einen Tipp exakt zum Spielbeginn', () => {
  expect(isTipOpen('2026-09-20T18:00:00Z', new Date('2026-09-20T17:59:59Z'))).toBe(true);
  expect(isTipOpen('2026-09-20T18:00:00Z', new Date('2026-09-20T18:00:00Z'))).toBe(false);
});
