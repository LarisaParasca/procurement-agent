import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import type { SourceRef } from "../domain/index.js";

export interface SourceDocument {
  ref: SourceRef;
  bytes: Buffer;
  mediaType: "application/pdf" | "application/xml";
}

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

/** Reads a document from disk. Phase 1: PDF. Phase 2 adds e-Factura XML (UBL) via the same SourceDocument. */
export function loadDocument(path: string): SourceDocument {
  const abs = resolve(path);
  const ext = extname(abs).toLowerCase();
  if (ext !== ".pdf") throw new Error(`unsupported document type ${ext} (Phase 1 supports PDF; e-Factura XML is Phase 2)`);
  const bytes = readFileSync(abs);
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error(`${path} is not a PDF`);
  return {
    ref: { path: relative(process.cwd(), abs), sha256: sha256(bytes), format: "pdf", pages: countPdfPages(bytes) },
    bytes,
    mediaType: "application/pdf",
  };
}

function countPdfPages(bytes: Buffer): number | undefined {
  const matches = bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches?.length || undefined;
}
