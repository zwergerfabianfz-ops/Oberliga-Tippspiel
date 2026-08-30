import { describe, expect, it } from 'vitest';
import { gamesForNextMatchday } from './gameFilters';
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
    predictedHome: null,
    predictedAway: null,
    points: null,
  };
}

describe('gamesForNextMatchday', () => {
  it('returns the complete official matchday even when games are on different dates', () => {
    const games = [
      game('later-round', '2026-09-25T17:30:00.000Z', false, 5),
      game('thursday', '2026-09-17T17:30:00.000Z', false, 1),
      game('friday', '2026-09-18T18:00:00.000Z', false, 1),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-16T12:00:00.000Z')).map(item => item.id)).toEqual(['thursday', 'friday']);
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

  it('falls back to the calendar day until matchday data has been imported', () => {
    const games = [
      game('first', '2026-09-20T13:00:00.000Z'),
      game('same-day', '2026-09-20T18:00:00.000Z'),
      game('later', '2026-09-21T18:00:00.000Z'),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-19T12:00:00.000Z')).map(item => item.id)).toEqual(['first', 'same-day']);
  });
});
