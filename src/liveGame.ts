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
