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
  const relevantGames = games
    .filter(game => !game.isFinal && new Date(game.startsAt).getTime() >= cutoff)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const nextGame = relevantGames[0];

  if (!nextGame) return [];
  const targetDay = berlinDay(nextGame.startsAt);
  const firstDayGames = games.filter(game => berlinDay(game.startsAt) === targetDay);
  if (firstDayGames.length !== 1) return firstDayGames;

  const followingGame = relevantGames.find(game => berlinDay(game.startsAt) !== targetDay);
  if (!followingGame) return firstDayGames;
  const followingDay = berlinDay(followingGame.startsAt);
  return games.filter(game => {
    const day = berlinDay(game.startsAt);
    return day === targetDay || day === followingDay;
  });
}

function berlinDay(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(new Date(value));
}
