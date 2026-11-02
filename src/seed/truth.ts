import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";
import { z } from "zod";
import {
  AgreementDocTypeSchema,
  CurrencySchema,
  RuleCodeSchema,
  SeveritySchema,
  TermSchema,
  VerdictSchema,
  type Agreement,
  type AgreementDocType,
  type Reference,
} from "../domain/index.js";
import type { Repos } from "../data/repos.js";
import { loadDocument } from "../ingest/document.js";
import { normalizeReference } from "../match/normalize.js";
import type { DatasetSpec, ReferenceDocSpec } from "./spec.js";
import { invoiceTotals } from "./templates.js";

// Ground-truth files, written by the seed and read by the eval. Committed to git (the PDFs are regenerated).

const PartyTruth = z.object({ name: z.string(), cui: z.string(), vatPayer: z.boolean(), role: z.string() });

export const AgreementTruthSchema = z.object({
  key: z.string(),
  file: z.string(),
  documentType: AgreementDocTypeSchema,
  number: z.string(),
  parties: z.array(PartyTruth),
  currency: CurrencySchema,
  validity: z.object({ from: z.string().optional(), to: z.string().optional() }),
  totalCap: z.string().optional(),
  terms: z.array(TermSchema),
});
export type AgreementTruth = z.infer<typeof AgreementTruthSchema>;

export const InvoiceTruthSchema = z.object({
  id: z.string(),
  file: z.string(),
  order: z.number(),
  scenario: z.string(),
  expectedAgreementKey: z.string().nullable(),
  expectedExtraction: z.object({
    series: z.string(),
    number: z.string(),
    issueDate: z.string(),
    dueDate: z.string(),
    issuerCui: z.string(),
    recipientCui: z.string(),
    currency: CurrencySchema,
    references: z.array(z.string()),
    lines: z.array(
      z.object({
        lineNo: z.number(),
        description: z.string(),
        unit: z.string(),
        quantity: z.string(),
        unitPrice: z.string(),
        net: z.string(),
        vatRate: z.string(),
      }),
    ),
    totals: z.object({ net: z.string(), vat: z.string(), gross: z.string() }),
  }),
  /** Agreement term id per invoice line (null = not covered). */
  expectedLineTerms: z.array(z.string().nullable()),
  expectedIssues: z.array(z.object({ code: RuleCodeSchema, severity: SeveritySchema, lineNo: z.number().optional() })),
  expectedVerdict: VerdictSchema,
});
export type InvoiceTruth = z.infer<typeof InvoiceTruthSchema>;

export const ManifestSchema = z.object({
  profileId: z.string(),
  references: z.array(AgreementTruthSchema),
  invoices: z.array(InvoiceTruthSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

export function buildManifest(spec: DatasetSpec): Manifest {
  return {
    profileId: spec.profileId,
    references: spec.references.map((r) => ({
      key: r.key,
      file: r.file,
      documentType: r.documentType,
      number: r.number,
      parties: [
        { ...pick(r.supplier), role: r.supplierRole ?? "supplier" },
        { ...pick(spec.buyer), role: r.buyerRole ?? "buyer" },
      ],
      currency: "RON",
      validity: r.validity,
      totalCap: r.totalCap,
      terms: r.terms,
    })),
    invoices: [...spec.invoices]
      .sort((a, b) => a.order - b.order)
      .map((inv) => {
        const totals = invoiceTotals(inv);
        return {
          id: inv.id,
          file: inv.file,
          order: inv.order,
          scenario: inv.scenario,
          expectedAgreementKey: inv.expectedAgreementKey,
          expectedExtraction: {
            series: inv.series,
            number: inv.number,
            issueDate: inv.issueDate,
            dueDate: inv.dueDate,
            issuerCui: inv.supplier.cui,
            recipientCui: spec.buyer.cui,
            currency: "RON" as const,
            references: inv.references,
            lines: inv.lines.map((l, i) => ({
              lineNo: i + 1,
              description: l.description,
              unit: l.unit,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              net: totals.lines[i]!.net.toFixed(2),
              vatRate: l.vatRate ?? "21",
            })),
            totals: { net: totals.net.toFixed(2), vat: totals.vat.toFixed(2), gross: totals.gross.toFixed(2) },
          },
          expectedLineTerms: inv.lines.map((l) => l.termId),
          expectedIssues: inv.expectedIssues,
          expectedVerdict: inv.expectedVerdict,
        };
      }),
  };
}

const pick = (c: { name: string; cui: string; vatPayer: boolean }) => ({ name: c.name, cui: c.cui, vatPayer: c.vatPayer });

export function readManifest(datasetDir: string): Manifest {
  return ManifestSchema.parse(JSON.parse(readFileSync(join(datasetDir, "truth", "manifest.json"), "utf8")));
}

const REF_KIND: Record<AgreementDocType, Reference["kind"]> = {
  contract: "contract_no",
  purchase_order: "po_no",
  offer: "offer_no",
  cost_estimate: "estimate_no",
  lease: "contract_no",
  brokerage: "contract_no",
  email_acceptance: "other",
  other: "other",
};

/** Canonical Agreement from a truth record — used by `seed --load-truth` and the eval's truth-agreements mode. */
export function agreementFromTruth(t: AgreementTruth, profileId: string, datasetDir: string): Agreement {
  const doc = loadDocument(join(datasetDir, t.file));
  return {
    id: ulid(),
    key: t.key,
    profileId,
    documentType: t.documentType,
    source: doc.ref,
    parties: t.parties as Agreement["parties"],
    currency: t.currency,
    pricesIncludeVat: false,
    validity: t.validity,
    references: [{ kind: REF_KIND[t.documentType], raw: t.number, normalized: normalizeReference(t.number) }],
    totalCap: t.totalCap,
    terms: t.terms,
    extraction: {
      confidence: 1,
      fieldConfidence: {},
      needsHumanReview: false,
      reviewReasons: [],
      model: "ground_truth",
      promptVersion: "n/a",
      extractedAt: new Date().toISOString(),
    },
    status: "active",
  };
}

export function loadTruthAgreements(repos: Repos, datasetDir: string): Agreement[] {
  const manifest = readManifest(datasetDir);
  return manifest.references.map((t) => {
    const agreement = agreementFromTruth(t, manifest.profileId, datasetDir);
    const id = repos.agreements.upsert(agreement);
    return { ...agreement, id };
  });
}

export type { ReferenceDocSpec };
