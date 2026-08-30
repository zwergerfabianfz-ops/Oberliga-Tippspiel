export type Season = {
  id: string;
  name: string;
  tablePredictionDeadline: string;
  status: 'upcoming' | 'regular' | 'playoffs' | 'finished';
};

export type Team = { id: string; name: string; shortName: string; logoUrl?: string | null; isCompetitor?: boolean };

export type Game = {
  id: string;
  phase: 'preseason' | 'regular' | 'playoffs';
  matchday: number | null;
  startsAt: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  isLive: boolean;
  isFinal: boolean;
  predictedHome: number | null;
  predictedAway: number | null;
  points: number | null;
};

export type RecentPrediction = {
  gameId: string;
  startsAt: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  isLive: boolean;
  isFinal: boolean;
  displayName: string;
  predictedHome: number;
  predictedAway: number;
  points: number | null;
};

export type LeaderboardEntry = {
  rank: number;
  displayName: string;
  points: number;
  exactTips?: number;
};
