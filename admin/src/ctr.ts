/** How a click-through rate compares with the others of its table. */
export type CtrLevel = 'good' | 'average' | 'low' | 'few';

// Fewer impressions than this, and a click or two swings the rate: too few to judge
export const MIN_VIEWS = 100;
const GOOD = 1.25;
const LOW = 0.75;

/** The CTR of the whole table: its clicks over its impressions, so that a large row weighs more. */
export function averageCtr(rows: { impressions: number; clicks: number }[]): number {
  const views = rows.reduce((sum, row) => sum + row.impressions, 0);
  return views > 0 ? rows.reduce((sum, row) => sum + row.clicks, 0) / views : 0;
}

export function ctrLevel(ctr: number, impressions: number, average: number): CtrLevel {
  if (impressions < MIN_VIEWS || average <= 0) return 'few';
  if (ctr >= average * GOOD) return 'good';
  if (ctr < average * LOW) return 'low';
  return 'average';
}
