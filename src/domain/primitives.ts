import Big from "big.js";
import { z } from "zod";

// Money and quantities are decimal strings ("1234.50"), never JS floats.
// All arithmetic goes through big.js so 0.1 + 0.2 really is 0.3 — finance cares.
export const DecimalSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a decimal string like 1234.50");
export type Decimal = z.infer<typeof DecimalSchema>;

export const ISODateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date YYYY-MM-DD");
export type ISODate = z.infer<typeof ISODateSchema>;

export const CurrencySchema = z.enum(["RON", "EUR", "USD"]);
export type Currency = z.infer<typeof CurrencySchema>;

export const PeriodSchema = z.object({ from: ISODateSchema, to: ISODateSchema });
export type Period = z.infer<typeof PeriodSchema>;

export const dec = (value: Decimal | number): Big => new Big(value);

/** Normalizes any numeric input (number from the LLM, "1.234,50" from a Romanian doc) to a Decimal. */
export function toDecimal(value: number | string): Decimal {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`not a finite number: ${value}`);
    return new Big(value).toString();
  }
  let s = value.trim().replace(/\s/g, "");
  // Romanian format uses "." for thousands and "," for decimals.
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  return new Big(s).toString();
}

export const fmt2 = (value: Decimal | Big): string => new Big(value).toFixed(2);

/** True when |a - b| <= tolerance. */
export const withinAbs = (a: Decimal | Big, b: Decimal | Big, tolerance: Decimal | Big): boolean =>
  new Big(a).minus(b).abs().lte(tolerance);

export const sumDecimals = (values: Array<Decimal | Big>): Big =>
  values.reduce<Big>((acc, v) => acc.plus(v), new Big(0));

export const dateInRange = (date: ISODate, from?: ISODate, to?: ISODate): boolean =>
  (from === undefined || date >= from) && (to === undefined || date <= to);
