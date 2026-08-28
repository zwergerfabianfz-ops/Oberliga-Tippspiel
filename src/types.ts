export type Season = {
  id: string;
  name: string;
  tablePredictionDeadline: string;
  status: 'upcoming' | 'regular' | 'playoffs' | 'finished';
};

export type Team = { id: string; name: string; shortName: string; logoUrl?: string | null };

export type Game = {
  id: string;
  phase: 'regular' | 'playoffs';
  startsAt: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  predictedHome: number | null;
  predictedAway: number | null;
  points: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  points: number;
  exactTips?: number;
};
