import type { Game } from './types';

const LIVE_WINDOW_MS = 5 * 60 * 60 * 1000;

export function gamesForNextMatchday(games: Game[], now = new Date()): Game[] {
  const cutoff = now.getTime() - LIVE_WINDOW_MS;
  const nextGame = games
    .filter(game => !game.isFinal && new Date(game.startsAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  if (!nextGame) return [];
  const targetDay = berlinDay(nextGame.startsAt);
  return games.filter(game => berlinDay(game.startsAt) === targetDay);
}

function berlinDay(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}
