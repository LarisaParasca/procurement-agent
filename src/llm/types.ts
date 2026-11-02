import type { z } from "zod";
import type { LlmTask } from "../config/env.js";
import type { LlmCallUsage } from "../domain/index.js";
import type { SourceDocument } from "../ingest/document.js";

export interface StructuredRequest<S extends z.ZodType> {
  task: LlmTask;
  /** Bumped whenever the prompt changes — part of the cache key and recorded with every extraction. */
  promptVersion: string;
  system: string;
  /** PDFs sent as native document blocks, before the text. */
  documents?: SourceDocument[];
  text: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: LlmCallUsage;
  model: string;
}

/** The only thing the pipeline knows about the LLM. Tests and offline evals inject a fake. */
export interface Llm {
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "refusal" | "max_tokens" | "invalid_output" | "no_api_key" | "api",
  ) {
    super(message);
  }
}
