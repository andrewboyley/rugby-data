// Mirrors config.py: legacy graph construction accepts international teams in
// either ESPN or RIMS namespace before flattening each eligible competitor.
const ESPN_IDS = new Set([
  1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 20, 23, 25, 27, 29, 57,
  81, 82, 289243,
]);

const RIMS_IDS = new Set([
  34, 35, 36, 33, 39, 38, 37, 42, 40, 51, 52, 46, 45, 47, 41, 49, 50, 44,
  68, 756, 720, 58, 703, 43, 708, 699, 735, 725, 64, 57, 736, 751, 2389,
]);

export function isInternationalTeam(teamId: number): boolean {
  return ESPN_IDS.has(teamId) || RIMS_IDS.has(teamId);
}
