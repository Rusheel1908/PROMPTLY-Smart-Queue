import type { Band } from './forecast.js';

export interface EtaShift { tokenId: string; deltaS: number }

export const SHIFT_THRESHOLD_MS = 60_000;

/**
 * Promise ledger diff: which tokens' expected call time moved by more than the
 * threshold between two forecasts. Tokens new to the forecast have no baseline yet.
 */
export function etaShifts(
  prev: Record<string, number | null>,
  next: Record<string, Band>,
  thresholdMs = SHIFT_THRESHOLD_MS,
): EtaShift[] {
  return Object.entries(next)
    .filter(([id]) => prev[id] != null)
    .map(([id, band]) => ({ tokenId: id, deltaS: Math.round((band.p50 - (prev[id] ?? 0)) / 1000) }))
    .filter((x) => Math.abs(x.deltaS) * 1000 >= thresholdMs);
}

/** Freeze an issue-time P90 as a customer-facing promise: whole minutes, with a minimum lead. */
export const toPromise = (p90: number, now: number, minLeadMs: number): number =>
  Math.ceil(Math.max(p90, now + minLeadMs) / 60_000) * 60_000;

/** A promise is at risk when the current P90 lands after the P90 frozen at issue time. */
export const atRisk = (promiseP90: number | null, band: Band | undefined): boolean =>
  promiseP90 != null && band != null && band.p90 > promiseP90;
