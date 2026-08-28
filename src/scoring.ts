export function scoreGameTip(
  predictedHome: number,
  predictedAway: number,
  actualHome: number,
  actualAway: number,
): number {
  if (predictedHome === actualHome && predictedAway === actualAway) return 3;

  const predictedDifference = predictedHome - predictedAway;
  const actualDifference = actualHome - actualAway;
  if (predictedDifference === actualDifference) return 2;

  if (Math.sign(predictedDifference) === Math.sign(actualDifference)) return 1;
  return 0;
}

export function scoreTablePosition(
  predictedPosition: number,
  actualPosition: number,
  teamCount: number,
): number {
  return Math.max(0, teamCount - Math.abs(predictedPosition - actualPosition));
}

export function isTipOpen(startsAt: string, now = new Date()): boolean {
  return now.getTime() < new Date(startsAt).getTime();
}
