import { Resvg } from "@resvg/resvg-js";
import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { A4, type Page } from "./layout.js";

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
const FONT_REGULAR = join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = join(FONT_DIR, "DejaVuSans-Bold.ttf");

// Fixed metadata dates keep the generated PDFs byte-for-byte reproducible.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function newDoc(title: string) {
  return new PDFDocument({
    size: "A4",
    margin: 0,
    autoFirstPage: false,
    info: { Title: title, Author: "invoice-check-agent seed (DATE FICTIVE)", CreationDate: FIXED_DATE, ModDate: FIXED_DATE },
  });
}

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Vector PDF with a real text layer. */
export async function renderPdf(pages: Page[], title: string): Promise<Buffer> {
  const doc = newDoc(title);
  doc.registerFont("regular", FONT_REGULAR);
  doc.registerFont("bold", FONT_BOLD);
  for (const page of pages) {
    doc.addPage();
    for (const op of page) {
      if (op.t === "text") {
        // The layout already wrapped the text; position by measured width so pdfkit never re-wraps it.
        doc.font(op.bold ? "bold" : "regular").fontSize(op.size).fillColor(op.color ?? "#111");
        const w = doc.widthOfString(op.text);
        const x =
          op.align === "right" ? op.x + (op.width ?? w) - w : op.align === "center" ? op.x + ((op.width ?? w) - w) / 2 : op.x;
        doc.text(op.text, x, op.y, { lineBreak: false });
      } else if (op.t === "line") {
        doc.moveTo(op.x1, op.y1).lineTo(op.x2, op.y2).lineWidth(op.width ?? 0.6).strokeColor(op.color ?? "#333").stroke();
      } else {
        doc.rect(op.x, op.y, op.w, op.h).lineWidth(op.width ?? 0.6);
        if (op.fill && op.stroke) doc.fillAndStroke(op.fill, op.stroke);
        else if (op.fill) doc.fill(op.fill);
        else doc.strokeColor(op.stroke ?? "#333").stroke();
      }
    }
  }
  return toBuffer(doc);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function pageToSvg(page: Page): string {
  const parts = page.map((op) => {
    if (op.t === "text") {
      const anchor = op.align === "right" ? "end" : op.align === "center" ? "middle" : "start";
      const x = op.align === "right" ? op.x + (op.width ?? 0) : op.align === "center" ? op.x + (op.width ?? 0) / 2 : op.x;
      // pdfkit positions text by its top; SVG by its baseline.
      return `<text x="${x}" y="${op.y + op.size * 0.85}" font-family="DejaVu Sans" font-size="${op.size}" font-weight="${op.bold ? "bold" : "normal"}" text-anchor="${anchor}" fill="${op.color ?? "#111"}">${esc(op.text)}</text>`;
    }
    if (op.t === "line") {
      return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.color ?? "#333"}" stroke-width="${op.width ?? 0.6}"/>`;
    }
    return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" fill="${op.fill ?? "none"}" stroke="${op.stroke ?? (op.fill ? "none" : "#333")}" stroke-width="${op.width ?? 0.6}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${A4.width}" height="${A4.height}" viewBox="0 0 ${A4.width} ${A4.height}"><rect width="100%" height="100%" fill="#fff"/>${parts.join("")}</svg>`;
}

/**
 * "Scanned" PDF: rasterize each page, then make it look like a photocopy — grayscale, slight
 * rotation, blur, uneven paper tone and speckle noise — and embed it as an image with NO text layer.
 * Claude has to read it visually, exactly like a real scan.
 */
export async function renderScannedPdf(pages: Page[], title: string, seed = 7): Promise<Buffer> {
  const doc = newDoc(title);
  for (const page of pages) {
    const png = new Resvg(pageToSvg(page), {
      fitTo: { mode: "zoom", value: 150 / 72 },
      font: { fontFiles: [FONT_REGULAR, FONT_BOLD], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" },
    })
      .render()
      .asPng();
    const scanned = await scanEffect(png, seed);
    doc.addPage();
    doc.image(scanned, 0, 0, { width: A4.width, height: A4.height });
  }
  return toBuffer(doc);
}

async function scanEffect(png: Buffer, seed: number): Promise<Buffer> {
  const base = sharp(png).grayscale();
  const { width = 0, height = 0 } = await base.metadata();
  // Deterministic speckle noise (seeded LCG) so the output is reproducible.
  const noise = Buffer.alloc(width * height);
  let s = seed;
  for (let i = 0; i < noise.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const r = s % 1000;
    noise[i] = r < 6 ? 60 : r < 12 ? 140 : 255;
  }
  const noiseImg = await sharp(noise, { raw: { width, height, channels: 1 } }).png().toBuffer();
  return base
    .composite([{ input: noiseImg, blend: "multiply" }])
    .linear(0.82, 28) // lower contrast, greyish paper
    .blur(0.7)
    .rotate(0.9, { background: "#e8e6e0" })
    .resize(width, height, { fit: "cover" })
    .jpeg({ quality: 55 })
    .toBuffer();
}
