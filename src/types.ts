export type Season = {
  id: string;
  name: string;
  tablePredictionDeadline: string;
  status: 'upcoming' | 'regular' | 'playoffs' | 'finished';
};

export type Team = { id: string; name: string; shortName: string; logoUrl?: string | null; isCompetitor?: boolean };

export type LiveStanding = {
  team: Team;
  position: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type Game = {
  id: string;
  externalId: string;
  phase: 'preseason' | 'regular' | 'playoffs';
  matchday: number | null;
  startsAt: string;
  homeTeam: Team;
  awayTeam: Team;
  homeScore: number | null;
  awayScore: number | null;
  isLive: boolean;
  isFinal: boolean;
  liveElapsedSeconds: number | null;
  livePhase: string | null;
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
  userId?: string;
  rank: number;
  displayName: string;
  points: number;
  exactTips?: number;
};

export type PlayerFinalTip = {
  gameId: string;
  startsAt: string;
  homeTeamName: string;
  awayTeamName: string;
  predictedHome: number;
  predictedAway: number;
  homeScore: number;
  awayScore: number;
  points: number;
};
