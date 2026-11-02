import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createSqliteRepos } from "../../src/data/sqlite/index.js";
import { TruthLlm } from "../../src/eval/truth-llm.js";
import { checkInvoice } from "../../src/pipeline/check-invoice.js";
import { datasetDir, DATASETS, generateDataset } from "../../src/seed/generate.js";
import { loadTruthAgreements, readManifest } from "../../src/seed/truth.js";
import { developerProfile } from "../factories.js";

// End-to-end over the whole developer dataset with a "perfect" LLM (answers from ground truth):
// proves the hand-written expected issues/verdicts agree with matching + ledger + rules + verdict code.

const dir = datasetDir("developer");

describe("developer dataset, end to end (offline)", () => {
  beforeAll(async () => {
    if (!existsSync(join(dir, "truth", "manifest.json")) || !existsSync(join(dir, "invoices", "I01_otel_clean.pdf"))) {
      await generateDataset(DATASETS.developer!);
    }
  }, 60_000);

  it("every invoice gets the expected match, issues and verdict", async () => {
    const repos = createSqliteRepos(":memory:");
    loadTruthAgreements(repos, dir);
    const manifest = readManifest(dir);
    const llm = new TruthLlm(manifest, dir, repos);

    const got: Array<{ id: string; key: string | null; issues: string[]; verdict: string }> = [];
    for (const t of manifest.invoices) {
      const { result, agreement } = await checkInvoice({ repos, llm, profile: developerProfile, llmReport: false }, join(dir, t.file));
      got.push({
        id: t.id,
        key: agreement?.key ?? null,
        issues: result.issues.map((i) => `${i.code}:${i.severity}${i.lineNo ? `:L${i.lineNo}` : ""}`).sort(),
        verdict: result.verdict,
      });
    }
    const expected = manifest.invoices.map((t) => ({
      id: t.id,
      key: t.expectedAgreementKey,
      issues: t.expectedIssues.map((i) => `${i.code}:${i.severity}${i.lineNo ? `:L${i.lineNo}` : ""}`).sort(),
      verdict: t.expectedVerdict,
    }));
    expect(got).toEqual(expected);
    repos.close();
  }, 60_000);

  it("checking the same file twice returns the stored result without new ledger entries", async () => {
    const repos = createSqliteRepos(":memory:");
    loadTruthAgreements(repos, dir);
    const manifest = readManifest(dir);
    const llm = new TruthLlm(manifest, dir, repos);
    const file = join(dir, manifest.invoices[0]!.file);
    const first = await checkInvoice({ repos, llm, profile: developerProfile, llmReport: false }, file);
    const second = await checkInvoice({ repos, llm, profile: developerProfile, llmReport: false }, file);
    expect(second.alreadyChecked).toBe(true);
    expect(second.result.id).toBe(first.result.id);
    expect(repos.ledger.forAgreement(first.agreement!.id)).toHaveLength(2);

    const again = await checkInvoice({ repos, llm, profile: developerProfile, llmReport: false }, file, { recheck: true });
    expect(again.result.issues.map((i) => i.code)).not.toContain("DUPLICATE_INVOICE");
    expect(repos.ledger.forAgreement(first.agreement!.id)).toHaveLength(2);
    repos.close();
  }, 60_000);
});
