import { describe, expect, it } from 'vitest';
import { gameTipsCsv } from './csv';

describe('gameTipsCsv', () => {
  it('creates an Excel-friendly semicolon CSV and escapes fields', () => {
    const csv = gameTipsCsv([{ player: 'Müller; Max', game_date: '2026-09-17', phase: 'regular', home_team: 'ESV "Kaufbeuren"', away_team: 'Tölz', tip_home: 3, tip_away: 2 }]);
    expect(csv).toContain('Spieler;Spielbeginn');
    expect(csv).toContain('"Müller; Max"');
    expect(csv).toContain('"ESV ""Kaufbeuren"""');
  });
});
