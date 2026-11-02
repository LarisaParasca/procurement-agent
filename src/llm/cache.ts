import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmCallUsage } from "../domain/index.js";

// Disk cache of LLM responses, keyed by everything that affects the output (model, prompt version,
// schema, document hash, text). Repeat evals cost nothing, and a live demo survives a flaky network.
// Each entry keeps the original usage so cached runs still report what the call really cost.

export interface CacheEntry {
  data: unknown;
  usage: LlmCallUsage;
  model: string;
  createdAt: string;
}

export class ResponseCache {
  constructor(
    private readonly dir: string,
    private readonly enabled = true,
  ) {}

  get(key: string): CacheEntry | undefined {
    if (!this.enabled) return undefined;
    try {
      return JSON.parse(readFileSync(this.path(key), "utf8")) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  set(key: string, entry: CacheEntry) {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.path(key), JSON.stringify(entry));
  }

  private path(key: string) {
    return join(this.dir, `${key}.json`);
  }
}
