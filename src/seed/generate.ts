import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { renderPdf, renderScannedPdf } from "./render.js";
import type { DatasetSpec } from "./spec.js";
import { invoicePages, referencePages } from "./templates.js";
import { buildManifest } from "./truth.js";
import { developerDataset } from "./datasets/developer.js";

export const DATASETS: Record<string, DatasetSpec> = { developer: developerDataset };

export const datasetDir = (profileId: string) => resolve(import.meta.dirname, "../../data/synthetic", profileId);

export interface GeneratedFile {
  path: string;
  kind: "reference" | "invoice" | "truth";
  label: string;
}

/** Writes every PDF and the truth manifest for one dataset. Deterministic: same spec → same bytes. */
export async function generateDataset(spec: DatasetSpec, outDir = datasetDir(spec.profileId)): Promise<GeneratedFile[]> {
  const written: GeneratedFile[] = [];
  const write = (rel: string, data: Buffer | string) => {
    const path = join(outDir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return path;
  };

  for (const ref of spec.references) {
    const pdf = await renderPdf(referencePages(ref, spec.buyer), `${ref.key} ${ref.number}`);
    written.push({ path: write(ref.file, pdf), kind: "reference", label: `${ref.key} · ${ref.documentType} ${ref.number}` });
  }
  for (const inv of spec.invoices) {
    const pages = invoicePages(inv, spec.buyer);
    const title = `Factura ${inv.series} ${inv.number}`;
    const pdf = inv.scanned ? await renderScannedPdf(pages, title) : await renderPdf(pages, title);
    written.push({ path: write(inv.file, pdf), kind: "invoice", label: `${inv.id} · ${inv.scenario}` });
  }
  const manifest = buildManifest(spec);
  // One truth file per document (human-readable), plus the manifest the eval reads.
  for (const t of manifest.invoices) write(`truth/${t.id}.json`, `${JSON.stringify(t, null, 2)}\n`);
  for (const t of manifest.references) write(`truth/${t.key}.json`, `${JSON.stringify(t, null, 2)}\n`);
  written.push({ path: write("truth/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`), kind: "truth", label: "ground truth manifest" });
  return written;
}
