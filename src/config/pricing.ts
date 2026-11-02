import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const ModelPriceSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});
const PricingSchema = z.object({ updated: z.string(), models: z.record(z.string(), ModelPriceSchema) });
export type Pricing = z.infer<typeof PricingSchema>;

let cached: Pricing | undefined;

export function loadPricing(path = resolve(import.meta.dirname, "../../config/pricing.json")): Pricing {
  cached ??= PricingSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return cached;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** USD cost of one call. Unknown models cost 0 and are flagged by the caller, not silently guessed. */
export function costUsd(model: string, t: TokenCounts, pricing = loadPricing()): number {
  const p = pricing.models[model];
  if (!p) return 0;
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cacheRead +
      t.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}
