import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { env, modelFor } from "../config/env.js";
import { costUsd } from "../config/pricing.js";
import type { LlmCallUsage } from "../domain/index.js";
import { sha256 } from "../ingest/document.js";
import { ResponseCache } from "./cache.js";
import { LlmError, type Llm, type StructuredRequest, type StructuredResult } from "./types.js";

// Models that support the server-side refusal fallback ("default" routing). Haiku has none.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export interface AnthropicLlmOptions {
  cacheDir?: string;
  /** Bypass the cache (still writes fresh results). */
  fresh?: boolean;
  /** Per-task model overrides (eval model matrix); default comes from env. */
  models?: Partial<Record<StructuredRequest<z.ZodType>["task"], string>>;
  onUsage?: (usage: LlmCallUsage, documentSha256?: string) => void;
}

/**
 * Structured extraction via the Messages API:
 *  - PDFs go in as native `document` blocks (Claude reads text layer *and* page images, so scans work)
 *  - output is constrained by a JSON schema (`output_config.format`) generated from zod, then parsed by the SDK
 *  - no assistant prefill and no forced tool_choice (both are rejected by current models)
 */
export class AnthropicLlm implements Llm {
  private client?: Anthropic;
  private readonly cache: ResponseCache;

  constructor(private readonly opts: AnthropicLlmOptions = {}) {
    this.cache = new ResponseCache(opts.cacheDir ?? env.LLM_CACHE_DIR, !opts.fresh);
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const model = this.opts.models?.[req.task] ?? modelFor(req.task);
    const effort = req.effort ?? "medium";
    const docSha = req.documents?.map((d) => d.ref.sha256).join(",");
    const key = sha256(
      JSON.stringify({
        model,
        effort,
        task: req.task,
        promptVersion: req.promptVersion,
        system: req.system,
        schema: z.toJSONSchema(req.schema),
        docSha,
        text: req.text,
      }),
    );

    const hit = this.cache.get(key);
    if (hit) {
      const usage = { ...hit.usage, cached: true };
      this.opts.onUsage?.(usage, docSha);
      return { data: req.schema.parse(hit.data), usage, model: hit.model };
    }

    const started = performance.now();
    const useFallback = env.LLM_REFUSAL_FALLBACK && FALLBACK_MODELS.has(model);
    let response;
    try {
      response = await this.getClient().beta.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        output_config: { format: betaZodOutputFormat(req.schema), effort },
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        messages: [
          {
            role: "user",
            content: [
              ...(req.documents ?? []).map((d) => ({
                type: "document" as const,
                source: { type: "base64" as const, media_type: "application/pdf" as const, data: d.bytes.toString("base64") },
              })),
              { type: "text" as const, text: req.text },
            ],
          },
        ],
      });
    } catch (err) {
      throw toLlmError(err);
    }
    const latencyMs = performance.now() - started;

    if (response.stop_reason === "refusal") {
      throw new LlmError(`${req.task}: the model declined the request (${response.stop_details?.category ?? "no category"})`, "refusal");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmError(`${req.task}: output hit max_tokens before the JSON was complete`, "max_tokens");
    }
    if (response.parsed_output == null) {
      throw new LlmError(`${req.task}: model output did not match the schema`, "invalid_output");
    }

    const u = response.usage;
    const tokens = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    // response.model is the model that actually served the request (differs if a fallback ran).
    const usage: LlmCallUsage = { task: req.task, model: response.model, ...tokens, costUsd: costUsd(response.model, tokens), latencyMs, cached: false };
    this.cache.set(key, { data: response.parsed_output, usage, model: response.model, createdAt: new Date().toISOString() });
    this.opts.onUsage?.(usage, docSha);
    return { data: response.parsed_output as z.infer<S>, usage, model: response.model };
  }

  private getClient(): Anthropic {
    if (!this.client) {
      if (!env.ANTHROPIC_API_KEY) {
        throw new LlmError("ANTHROPIC_API_KEY is not set — copy .env.example to .env and add your key (cached results work without it)", "no_api_key");
      }
      this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });
    }
    return this.client;
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof Anthropic.AuthenticationError) return new LlmError("Anthropic API key was rejected (401) — check ANTHROPIC_API_KEY", "api");
  if (err instanceof Anthropic.NotFoundError) return new LlmError(`model not found (404): ${err.message} — check the MODEL_* settings`, "api");
  if (err instanceof Anthropic.RateLimitError) return new LlmError("rate limited by the Anthropic API (429) after retries — try again shortly", "api");
  if (err instanceof Anthropic.BadRequestError) return new LlmError(`request rejected (400): ${err.message}`, "api");
  if (err instanceof Anthropic.APIConnectionError) return new LlmError("cannot reach the Anthropic API — check the network (cached results still work)", "api");
  if (err instanceof Anthropic.APIError) return new LlmError(`Anthropic API error ${err.status ?? ""}: ${err.message}`, "api");
  return err instanceof LlmError ? err : new LlmError((err as Error).message, "api");
}
