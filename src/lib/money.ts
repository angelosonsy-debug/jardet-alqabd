/**
 * All money in this app is stored and computed as integer piastres (قروش).
 * Never do money math in floating point — only here, in one place.
 */
export const EGP_TO_CENTS = 100;

export function poundsToCents(pounds: number): number {
  // Round to nearest piastre to kill any float noise from parsing (e.g. 306.0299999...)
  return Math.round(pounds * EGP_TO_CENTS);
}

export function centsToPounds(cents: number): number {
  return cents / EGP_TO_CENTS;
}

export function formatEGP(cents: number): string {
  return (cents / EGP_TO_CENTS).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
