import { describe, expect, it } from 'vitest';
import { arePreseasonGamesVisible, gamesForNextMatchday } from './gameFilters';
import type { Game } from './types';

const team = { id: 'team', name: 'Team', shortName: 'TEM' };

function game(id: string, startsAt: string, isFinal = false, matchday: number | null = null): Game {
  return {
    id,
    phase: 'regular',
    matchday,
    startsAt,
    homeTeam: team,
    awayTeam: { ...team, id: 'away' },
    homeScore: null,
    awayScore: null,
    isLive: false,
    isFinal,
    liveElapsedSeconds: null,
    livePhase: null,
    predictedHome: null,
    predictedAway: null,
    points: null,
  };
}

describe('gamesForNextMatchday', () => {
  it('adds the following game date when the first date only contains a single game', () => {
    const games = [
      game('later-round', '2026-09-25T17:30:00.000Z', false, 5),
      game('thursday', '2026-09-17T17:30:00.000Z', false, 1),
      ...Array.from({ length: 6 }, (_, index) => game(`friday-${index + 1}`, `2026-09-18T${String(12 + index).padStart(2, '0')}:00:00.000Z`, false, 1)),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-16T12:00:00.000Z')).map(item => item.id)).toEqual([
      'thursday',
      'friday-1',
      'friday-2',
      'friday-3',
      'friday-4',
      'friday-5',
      'friday-6',
    ]);
  });

  it('does not rely on incorrect matchday metadata', () => {
    const games = [
      game('first-day-1', '2026-09-20T13:00:00.000Z', false, 1),
      game('first-day-2', '2026-09-20T18:00:00.000Z', false, 1),
      game('later', '2026-09-27T18:00:00.000Z', false, 1),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-19T12:00:00.000Z')).map(item => item.id)).toEqual(['first-day-1', 'first-day-2']);
  });

  it('keeps completed games from the current matchday visible', () => {
    const games = [
      game('finished-today', '2026-09-20T13:00:00.000Z', true),
      game('upcoming-today', '2026-09-20T18:00:00.000Z'),
      game('next-day', '2026-09-21T18:00:00.000Z'),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-20T16:00:00.000Z')).map(item => item.id)).toEqual(['finished-today', 'upcoming-today']);
  });

  it('ignores stale unfinished games from earlier dates', () => {
    const games = [
      game('stale', '2026-09-10T18:00:00.000Z'),
      game('next', '2026-09-20T18:00:00.000Z'),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-19T12:00:00.000Z')).map(item => item.id)).toEqual(['next']);
  });

  it('uses the next calendar day when it contains multiple games', () => {
    const games = [
      game('first', '2026-09-20T13:00:00.000Z'),
      game('same-day', '2026-09-20T18:00:00.000Z'),
      game('later', '2026-09-21T18:00:00.000Z'),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-19T12:00:00.000Z')).map(item => item.id)).toEqual(['first', 'same-day']);
  });
});

describe('arePreseasonGamesVisible', () => {
  it('shows test games only before the first regular-season game', () => {
    const preseason = { ...game('test', '2026-09-10T18:00:00.000Z'), phase: 'preseason' as const };
    const regular = game('season-opener', '2026-09-20T18:00:00.000Z');

    expect(arePreseasonGamesVisible([preseason, regular], new Date('2026-09-19T18:00:00.000Z'))).toBe(true);
    expect(arePreseasonGamesVisible([preseason, regular], new Date('2026-09-20T18:00:00.000Z'))).toBe(false);
  });
});
