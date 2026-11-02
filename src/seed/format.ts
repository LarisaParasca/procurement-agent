import Big from "big.js";

/** Romanian number format: 35.530,00 */
export function ron(value: string | Big, decimals = 2): string {
  const [int, frac] = new Big(value).toFixed(decimals).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${grouped},${frac}` : grouped;
}

/** Quantities: no trailing zeros, Romanian decimal comma. */
export function qty(value: string): string {
  const s = new Big(value).toString();
  return s.includes(".") ? ron(s, s.split(".")[1]!.length) : ron(s, 0);
}

/** 2026-03-20 → 20.03.2026 */
export const roDate = (iso: string) => iso.split("-").reverse().join(".");
