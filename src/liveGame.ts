export function liveClockLabel(elapsedSeconds: number | null, phase: string | null): string {
  const normalizedPhase = phase?.toUpperCase() ?? '';
  if (normalizedPhase.includes('SHOOT')) return 'Penaltyschießen';
  if (normalizedPhase.includes('OVERTIME')) return elapsedSeconds !== null && elapsedSeconds > 3600
    ? `${Math.ceil(elapsedSeconds / 60)}. Minute · Verlängerung`
    : 'Verlängerung';

  if (elapsedSeconds === null || !Number.isFinite(elapsedSeconds)) return 'Spiel läuft';
  const minute = Math.max(1, Math.ceil(elapsedSeconds / 60));
  return normalizedPhase.includes('INTERMISSION')
    ? `Pause nach ${minute}. Minute`
    : `${minute}. Minute`;
}

const LIVE_TEAM_PRIORITY = ['ESV Kaufbeuren', 'EC Peiting', 'Tölzer Löwen', 'SC Riessersee'];

type LiveGameSortCandidate = {
  startsAt: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
};

/** Keeps the live-score area predictable instead of following API response order. */
export function compareLiveGames(a: LiveGameSortCandidate, b: LiveGameSortCandidate, favoriteTeamId: string | null): number {
  const priority = (game: LiveGameSortCandidate) => {
    if (favoriteTeamId && (game.homeTeam.id === favoriteTeamId || game.awayTeam.id === favoriteTeamId)) return 0;
    const teamPriority = Math.min(
      ...[game.homeTeam.name, game.awayTeam.name].map(name => {
        const index = LIVE_TEAM_PRIORITY.indexOf(name);
        return index === -1 ? Number.MAX_SAFE_INTEGER : index + 1;
      }),
    );
    return teamPriority;
  };
  const byPriority = priority(a) - priority(b);
  if (byPriority) return byPriority;
  const byStart = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  if (byStart) return byStart;
  return `${a.homeTeam.name}-${a.awayTeam.name}`.localeCompare(`${b.homeTeam.name}-${b.awayTeam.name}`, 'de');
}
