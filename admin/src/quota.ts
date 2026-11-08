import type { DailyStats } from './api';

// Rule of the Creators API documentation (concepts/api-rates), which names no currency
const REVENUE_PER_DAILY_REQUEST = 0.05;
const REVENUE_PER_REQUEST_PER_SECOND = 4320;
const MAX_REQUESTS_PER_SECOND = 10;
const SECONDS_PER_DAY = 86400;

/** Allocation of the first 30 days after creating the credentials. */
export const INITIAL_QUOTA = { perSecond: 1, perDay: 8640 };

export interface QuotaEstimate {
  perSecond: number;
  /** What the rule grants, never more than the per-second limit can use in a day. */
  perDay: number;
}

/**
 * The per-second figure is at least 1: the rule gives 0 below 4,320, which cannot be right for
 * an account Amazon still answers. The documentation does not state that minimum.
 */
export function estimateQuota(shippedRevenue: number): QuotaEstimate {
  const perSecond = Math.min(MAX_REQUESTS_PER_SECOND, Math.max(1, Math.floor(shippedRevenue / REVENUE_PER_REQUEST_PER_SECOND)));
  // Rounded first: 0.15 / 0.05 is 2.9999999999999996 in floating point
  const granted = Math.floor(Number((shippedRevenue / REVENUE_PER_DAILY_REQUEST).toFixed(6)));
  return { perSecond, perDay: Math.min(granted, perSecond * SECONDS_PER_DAY) };
}

export interface AmazonUsage {
  average: number;
  peak: number;
  /** Some days are estimated from the lookups: they were not counted yet. */
  approximate: boolean;
}

/**
 * Requests sent to Amazon on a day: counted by the server since it counts them, otherwise
 * approximated by the lookups that went to Amazon. The approximation counts a remembered
 * "not found" without a call, and misses the batch calls, the previews and the settings test.
 */
export function amazonCallsOf(day: DailyStats): { calls: number; counted: boolean } {
  return typeof day.amazonCalls === 'number'
    ? { calls: day.amazonCalls, counted: true }
    : { calls: day.amazon + day.notfound, counted: false };
}

export function amazonUsage(daily: DailyStats[]): AmazonUsage {
  const days = daily.map(amazonCallsOf);
  const calls = days.map(day => day.calls);
  return {
    average: calls.length > 0 ? Math.round(calls.reduce((sum, value) => sum + value, 0) / calls.length) : 0,
    peak: Math.max(0, ...calls),
    approximate: days.some(day => !day.counted)
  };
}
