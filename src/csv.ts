export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function gameTipsCsv(rows: Record<string, unknown>[]): string {
  const headers = ['Spieler', 'Spielbeginn', 'Phase', 'Heimteam', 'Auswärtsteam', 'Tipp Heim', 'Tipp Auswärts', 'Ergebnis Heim', 'Ergebnis Auswärts', 'Beendet', 'Punkte', 'Tipp geändert am'];
  const keys = ['player', 'game_date', 'phase', 'home_team', 'away_team', 'tip_home', 'tip_away', 'actual_home', 'actual_away', 'game_finished', 'points', 'tip_updated_at'];
  return [headers, ...rows.map(row => keys.map(key => csvCell(row[key])))]
    .map(line => line.join(';'))
    .join('\r\n');
}
