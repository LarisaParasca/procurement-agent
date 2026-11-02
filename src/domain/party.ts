import { z } from "zod";

export const PartySchema = z.object({
  name: z.string().min(1),
  /** Normalized CUI: digits only, without the "RO" VAT prefix. */
  cui: z.string().regex(/^\d{2,10}$/, "CUI must be 2–10 digits"),
  /** True when the party is shown with the "RO" prefix (registered for VAT). */
  vatPayer: z.boolean(),
  regCom: z.string().optional(),
  address: z.string().optional(),
  iban: z.string().optional(),
});
export type Party = z.infer<typeof PartySchema>;

/** Strips spaces and the "RO" prefix: "RO 12345678" → "12345678". */
export function normalizeCui(raw: string): string {
  return raw.toUpperCase().replace(/\s/g, "").replace(/^RO/, "");
}

/**
 * Validates a Romanian CUI/CIF check digit (ANAF algorithm, key 753217532).
 * Used to flag extraction errors — a misread digit almost always breaks the checksum.
 */
export function isValidCui(raw: string): boolean {
  const cui = normalizeCui(raw);
  if (!/^\d{2,10}$/.test(cui)) return false;
  const key = "753217532";
  const digits = cui.slice(0, -1).padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * Number(key[i]);
  let control = (sum * 10) % 11;
  if (control === 10) control = 0;
  return control === Number(cui.at(-1));
}

/** Appends a valid check digit to a base number — used by the seed to make fictional CUIs that validate. */
export function withCuiCheckDigit(base: string): string {
  const key = "753217532";
  const digits = base.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * Number(key[i]);
  let control = (sum * 10) % 11;
  if (control === 10) control = 0;
  return `${base}${control}`;
}
