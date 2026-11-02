// A tiny page-description model: templates emit drawing ops once, and two backends render them —
// pdfkit (real PDF with a text layer) and SVG (rasterized for the "scanned" variant).

export const A4 = { width: 595.28, height: 841.89 };

export type Op =
  | { t: "text"; x: number; y: number; text: string; size: number; bold?: boolean; align?: "left" | "right" | "center"; width?: number; color?: string }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width?: number; color?: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; width?: number };

export type Page = Op[];

/** Approximate DejaVu Sans advance width — good enough for wrapping and right-aligned columns. */
export const textWidth = (s: string, size: number, bold = false) => s.length * size * (bold ? 0.64 : 0.58);

/** Greedy word wrap using the same width estimate in both backends, so line breaks match. */
export function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, size, bold) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** Helper that tracks a vertical cursor while emitting ops. */
export class PageBuilder {
  readonly pages: Page[] = [[]];
  y: number;

  constructor(
    readonly margin = 45,
    readonly bottom = A4.height - 50,
  ) {
    this.y = margin;
  }

  get page(): Page {
    return this.pages.at(-1)!;
  }
  get contentWidth() {
    return A4.width - 2 * this.margin;
  }

  ensure(height: number) {
    if (this.y + height > this.bottom) {
      this.pages.push([]);
      this.y = this.margin;
    }
  }

  text(text: string, opts: { size?: number; bold?: boolean; x?: number; width?: number; align?: "left" | "right" | "center"; gap?: number; color?: string } = {}) {
    const size = opts.size ?? 9;
    const x = opts.x ?? this.margin;
    const width = opts.width ?? this.contentWidth - (x - this.margin);
    const lines = wrap(text, size, width, opts.bold);
    for (const line of lines) {
      this.ensure(size * 1.35);
      this.page.push({ t: "text", x, y: this.y, text: line, size, bold: opts.bold, align: opts.align, width, color: opts.color });
      this.y += size * 1.35;
    }
    this.y += opts.gap ?? 0;
  }

  /** Emits ops at absolute positions without moving the cursor. */
  at(op: Op) {
    this.page.push(op);
  }

  hr(gap = 6, width = 0.6) {
    this.page.push({ t: "line", x1: this.margin, y1: this.y, x2: A4.width - this.margin, y2: this.y, width });
    this.y += gap;
  }

  space(h: number) {
    this.y += h;
  }
}
