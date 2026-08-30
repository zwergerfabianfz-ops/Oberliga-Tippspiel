import { describe, expect, it } from 'vitest';
import { gamesForNextMatchday } from './gameFilters';
import type { Game } from './types';

const team = { id: 'team', name: 'Team', shortName: 'TEM' };

function game(id: string, startsAt: string, isFinal = false): Game {
  return {
    id,
    phase: 'regular',
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
  it('returns every game on the earliest upcoming Berlin calendar day', () => {
    const games = [
      game('later', '2026-09-25T17:30:00.000Z'),
      game('first', '2026-09-20T13:00:00.000Z'),
      game('same-day', '2026-09-20T18:00:00.000Z'),
    ];

    expect(gamesForNextMatchday(games, new Date('2026-09-19T12:00:00.000Z')).map(item => item.id)).toEqual(['first', 'same-day']);
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
});
