import type { Game } from './types';

const LIVE_WINDOW_MS = 5 * 60 * 60 * 1000;

export function arePreseasonGamesVisible(games: Game[], now = new Date()): boolean {
  const firstRegularGame = games
    .filter(game => game.phase === 'regular')
    .reduce<number | null>((earliest, game) => {
      const start = new Date(game.startsAt).getTime();
      return earliest === null || start < earliest ? start : earliest;
    }, null);
  return games.some(game => game.phase === 'preseason') && (firstRegularGame === null || now.getTime() < firstRegularGame);
}

export function gamesForNextMatchday(games: Game[], now = new Date()): Game[] {
  const cutoff = now.getTime() - LIVE_WINDOW_MS;
  const nextGame = games
    .filter(game => !game.isFinal && new Date(game.startsAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];

  if (!nextGame) return [];
  if (nextGame.matchday !== null) {
    return games.filter(game => game.matchday === nextGame.matchday);
  }
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
