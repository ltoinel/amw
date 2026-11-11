import type { EffectStats, VariantDay } from './api';

// Below these, a difference is mostly noise, whatever the test below says
const MIN_VIEWS = 500;
const MIN_CLICKS = 10;
// Two-sided z for a 5 % risk of a false winner over all the comparisons with the control group
// (Bonferroni): each variant compared is one more chance of a lucky winner
const SIGNIFICANT_Z = [1.96, 1.96, 2.24, 2.39, 2.5, 2.58, 2.64, 2.69, 2.73, 2.77];
// Beyond this, the current traffic will not settle the test in any useful time: the gap, if any,
// is too small to matter
const MAX_DAYS_LEFT = 90;

export type Verdict = 'control' | 'more-data' | 'better' | 'worse' | 'no-difference';

/** One group of an A/B test: an effect or a theme. */
export interface VariantStats {
  name: string;
  views: number;
  clicks: number;
  ctr: number;
  /** The figures of each day of the period, oldest first, when the server sends them. */
  daily?: VariantDay[];
}

export interface VariantComparison extends VariantStats {
  /** Relative to the control group: 0.1 for 10 % more clicks per impression. Null without a control. */
  uplift: number | null;
  /**
   * The range of the uplift at the confidence of the verdict (95 % over all the comparisons): the
   * true uplift is likely inside. Null without clicks on both sides.
   */
  interval: [number, number] | null;
  /**
   * Days of the current traffic still needed before a verdict, assuming the click-through rates
   * stay as they are; Infinity when that is beyond any useful time. Null when it cannot be told
   * (no running test, too little data) or when the verdict is already there.
   */
  daysLeft: number | null;
  verdict: Verdict;
}

export type EffectComparison = EffectStats & Omit<VariantComparison, keyof VariantStats>;

/** Two-proportion z-test. An approximation: cards seen in one session are not fully independent. */
function zScore(a: VariantStats, b: VariantStats): number {
  const pooled = (a.clicks + b.clicks) / (a.views + b.views);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / a.views + 1 / b.views));
  return error > 0 ? (a.ctr - b.ctr) / error : 0;
}

/**
 * Range of the uplift (ratio of the click-through rates, minus one) from the log of the ratio,
 * whose error is close to normal even for small rates.
 */
function upliftInterval(row: VariantStats, reference: VariantStats, z: number): [number, number] | null {
  if ([row, reference].some(side => side.clicks <= 0 || side.views <= 0)) return null;
  const ratio = Math.log(row.ctr / reference.ctr);
  const error = Math.sqrt(1 / row.clicks - 1 / row.views + 1 / reference.clicks - 1 / reference.views);
  return [Math.exp(ratio - z * error) - 1, Math.exp(ratio + z * error) - 1];
}

/**
 * At the same daily traffic and rates, the counts grow with the days and the z-score with their
 * square root: the factor by which the data must grow gives the days left.
 */
function daysToVerdict(row: VariantStats, reference: VariantStats, threshold: number, days: number): number | null {
  if ([row, reference].some(side => side.clicks <= 0 || side.views <= 0)) return null;
  const forMinimums = Math.max(...[row, reference].flatMap(side => [MIN_VIEWS / side.views, MIN_CLICKS / side.clicks]));
  const z = Math.abs(zScore(row, reference));
  const forSignificance = z > 0 ? (threshold / z) ** 2 : Infinity;
  const left = Math.ceil(days * (Math.max(forMinimums, forSignificance) - 1));
  return left > MAX_DAYS_LEFT ? Infinity : Math.max(left, 1);
}

/**
 * @param control The name of the control group; without its row, nothing can be called a winner.
 * @param days The days of data behind the rows, when a test is running: without it, no estimate
 * of the days left.
 */
export function compareVariants(rows: VariantStats[], control: string, days?: number | null): VariantComparison[] {
  const reference = rows.find(row => row.name === control);
  const threshold = SIGNIFICANT_Z[Math.min(Math.max(rows.length - 1, 1), SIGNIFICANT_Z.length - 1)];
  return rows.map(row => {
    if (row.name === control) {
      return { ...row, uplift: null, interval: null, daysLeft: null, verdict: 'control' };
    }
    const uplift = reference && reference.ctr > 0 ? row.ctr / reference.ctr - 1 : null;
    const interval = reference ? upliftInterval(row, reference, threshold) : null;
    const estimate = () => (reference && days && days > 0 ? daysToVerdict(row, reference, threshold, days) : null);
    if (!reference || [row, reference].some(side => side.views < MIN_VIEWS || side.clicks < MIN_CLICKS)) {
      return { ...row, uplift, interval, daysLeft: estimate(), verdict: 'more-data' };
    }
    const z = zScore(row, reference);
    if (Math.abs(z) < threshold) {
      return { ...row, uplift, interval, daysLeft: estimate(), verdict: 'no-difference' };
    }
    return { ...row, uplift, interval, daysLeft: null, verdict: z > 0 ? 'better' : 'worse' };
  });
}

/** "none", no effect at all, is the control group of the effects. */
export function compareEffects(rows: EffectStats[]): EffectComparison[] {
  return compareVariants(rows.map(({ effect, ...figures }) => ({ name: effect, ...figures })), 'none')
    .map(({ name, ...rest }) => ({ effect: name, ...rest }));
}
