/**
 * HockeyData occasionally exposes a live status before the scheduled face-off.
 * The official start time remains the hard boundary for hiding the tip fields.
 */
export function isOfficiallyLive(sourceSaysLive: boolean, startsAt: string, now = Date.now()): boolean {
  return sourceSaysLive && new Date(startsAt).getTime() <= now;
}
