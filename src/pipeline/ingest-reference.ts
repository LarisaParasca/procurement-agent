import type { Agreement, LlmCallUsage, Profile } from "../domain/index.js";
import type { Repos } from "../data/repos.js";
import { classifyDocument, extractAgreement } from "../extract/extract.js";
import { loadDocument } from "../ingest/document.js";
import type { Llm } from "../llm/types.js";

export interface IngestOutcome {
  agreement: Agreement;
  usage: LlmCallUsage[];
}

/** Reference document → canonical Agreement → DB. Re-ingesting the same file replaces the earlier extraction. */
export async function ingestReference(
  deps: { repos: Repos; llm: Llm; profile: Profile },
  file: string,
  opts: { key?: string; skipClassify?: boolean; onStep?: (s: string) => void } = {},
): Promise<IngestOutcome> {
  const step = opts.onStep ?? (() => {});
  const doc = loadDocument(file);
  const usage: LlmCallUsage[] = [];
  if (!opts.skipClassify) {
    step("classifying document");
    const { classification, usage: u } = await classifyDocument(deps.llm, doc);
    usage.push(u);
    if (classification.kind === "invoice") {
      throw new Error(`this looks like an invoice — use \`npm run check -- ${file}\` instead`);
    }
  }
  step("extracting the agreement");
  const { agreement, usage: u } = await extractAgreement(deps.llm, doc, deps.profile);
  usage.push(u);
  const withKey = opts.key ? { ...agreement, key: opts.key } : agreement;
  const id = deps.repos.agreements.upsert(withKey);
  return { agreement: { ...withKey, id }, usage };
}
