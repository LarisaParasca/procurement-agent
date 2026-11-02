import { join } from "node:path";
import type { z } from "zod";
import type { Repos } from "../data/repos.js";
import type { InvoiceOut } from "../extract/api-schemas.js";
import { loadDocument } from "../ingest/document.js";
import { AGREEMENT_MATCH_PROMPT, LINE_MATCH_PROMPT } from "../llm/prompts/match.js";
import { CLASSIFY_PROMPT, INVOICE_PROMPT } from "../llm/prompts/extract.js";
import { LlmError, type Llm, type StructuredRequest, type StructuredResult } from "../llm/types.js";
import type { InvoiceTruth, Manifest } from "../seed/truth.js";

/**
 * A "perfect" LLM that answers from the ground truth. Used by the offline eval mode and the
 * end-to-end test: it isolates everything the code does (matching, ledger, rules, verdict) from
 * model quality, at zero cost. The report task throws, so the deterministic template is used.
 */
export class TruthLlm implements Llm {
  private readonly bySha = new Map<string, InvoiceTruth>();

  constructor(
    private readonly manifest: Manifest,
    datasetDir: string,
    private readonly repos: Repos,
  ) {
    for (const t of manifest.invoices) this.bySha.set(loadDocument(join(datasetDir, t.file)).ref.sha256, t);
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<StructuredResult<z.infer<S>>> {
    const usage = { task: req.task, model: "truth", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, latencyMs: 0, cached: false };
    const done = (data: unknown) => ({ data: req.schema.parse(data) as z.infer<S>, usage, model: "truth" });
    const truth = req.documents?.[0] ? this.bySha.get(req.documents[0].ref.sha256) : this.current;

    switch (req.promptVersion) {
      case CLASSIFY_PROMPT.version:
        return done({ kind: truth ? "invoice" : "reference", documentType: null, confidence: 1, reason: "ground truth" });
      case INVOICE_PROMPT.version: {
        if (!truth) throw new LlmError("TruthLlm: no truth for this document", "invalid_output");
        this.current = truth;
        return done(invoiceOutFromTruth(truth, this.partyNames()));
      }
      case AGREEMENT_MATCH_PROMPT.version: {
        const key = this.current?.expectedAgreementKey;
        const id = key ? this.repos.agreements.getByKey(key)?.id ?? null : null;
        return done({ agreementId: id, confidence: id ? 0.95 : 0.2, rationale: "ground truth" });
      }
      case LINE_MATCH_PROMPT.version: {
        const lineNos = [...req.text.matchAll(/"lineNo": (\d+)/g)].map((m) => Number(m[1]));
        return done({
          lines: lineNos.map((lineNo) => ({ lineNo, termId: this.current?.expectedLineTerms[lineNo - 1] ?? null, confidence: 0.95, rationale: "ground truth" })),
        });
      }
      default:
        throw new LlmError(`TruthLlm does not handle ${req.promptVersion}`, "api");
    }
  }

  private partyNames(): Map<string, string> {
    return new Map(this.manifest.references.flatMap((r) => r.parties.map((p) => [p.cui, p.name] as const)));
  }

  /** The invoice being checked (matching calls carry no document). */
  private current: InvoiceTruth | undefined;
}

function invoiceOutFromTruth(t: InvoiceTruth, names: Map<string, string>): InvoiceOut {
  const e = t.expectedExtraction;
  const party = (fallback: string, cui: string) => ({ name: names.get(cui) ?? fallback, cui: `RO${cui}`, regCom: null, address: null, iban: null });
  const byRate = new Map<string, { base: number }>();
  for (const l of e.lines) byRate.set(l.vatRate, { base: (byRate.get(l.vatRate)?.base ?? 0) + Number(l.net) });
  return {
    series: e.series,
    number: e.number,
    issueDate: e.issueDate,
    dueDate: e.dueDate,
    servicePeriodFrom: null,
    servicePeriodTo: null,
    issuer: party("issuer", e.issuerCui),
    recipient: party("recipient", e.recipientCui),
    currency: e.currency,
    references: e.references.map((raw) => ({ kind: "other" as const, raw })),
    lines: e.lines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      net: Number(l.net),
      vatRate: Number(l.vatRate),
      periodFrom: null,
      periodTo: null,
      percentageBase: null,
    })),
    vatLines: [...byRate].map(([rate, { base }]) => ({ rate: Number(rate), base, amount: Number(((base * Number(rate)) / 100).toFixed(2)) })),
    totals: { net: Number(e.totals.net), vat: Number(e.totals.vat), gross: Number(e.totals.gross) },
    confidence: { overall: 1, parties: 1, numberAndDates: 1, lines: 1, totals: 1 },
    unreadable: [],
  };
}
