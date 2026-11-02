import Big from "big.js";
import { A4, PageBuilder, wrap, type Page } from "./layout.js";
import { qty, roDate, ron } from "./format.js";
import type { CompanySpec, InvoiceSpec, ReferenceDocSpec } from "./spec.js";

const FICTIVE = "DATE FICTIVE — document generat automat pentru demonstrație. Nu are valoare juridică sau fiscală.";
const GREY = "#555";

function companyBlock(b: PageBuilder, label: string, c: CompanySpec, x: number, width: number, top: number) {
  const saved = b.y;
  b.y = top;
  b.text(label, { size: 8, bold: true, x, width, color: GREY });
  b.text(c.name, { size: 10, bold: true, x, width });
  b.text(`CUI: ${c.vatPayer ? "RO" : ""}${c.cui}   Reg. Com.: ${c.regCom}`, { size: 8, x, width });
  b.text(`Sediu: ${c.address}`, { size: 8, x, width });
  b.text(`IBAN: ${c.iban}`, { size: 8, x, width });
  b.text(`Banca: ${c.bank}`, { size: 8, x, width });
  const end = b.y;
  b.y = saved;
  return end;
}

function footer(b: PageBuilder, extra?: string) {
  for (const [i, page] of b.pages.entries()) {
    page.push({ t: "line", x1: b.margin, y1: A4.height - 42, x2: A4.width - b.margin, y2: A4.height - 42, width: 0.4, color: "#999" });
    page.push({ t: "text", x: b.margin, y: A4.height - 36, text: extra ? `${extra}  ·  ${FICTIVE}` : FICTIVE, size: 6.5, color: "#777", width: b.contentWidth - 40 });
    page.push({ t: "text", x: b.margin, y: A4.height - 36, text: `Pag. ${i + 1}/${b.pages.length}`, size: 6.5, color: "#777", align: "right", width: b.contentWidth });
  }
}

interface Column {
  title: string;
  width: number;
  align?: "left" | "right" | "center";
}

/** Table with wrapped cells: each row is as tall as its tallest cell. */
function table(b: PageBuilder, columns: Column[], rows: string[][]) {
  const x0 = b.margin;
  const cell = (texts: string[], size: number, bold: boolean) => texts.map((t, i) => wrap(t, size, columns[i]!.width - 6, bold));
  const drawRow = (lines: string[][], size: number, bold: boolean, top: number) => {
    let x = x0;
    lines.forEach((cellLines, i) => {
      const c = columns[i]!;
      cellLines.forEach((text, j) =>
        b.at({ t: "text", x: x + 3, y: top + j * size * 1.25, text, size, bold, width: c.width - 6, align: c.align ?? "left" }),
      );
      x += c.width;
    });
  };

  const header = cell(columns.map((c) => c.title), 7, true);
  const headerH = Math.max(...header.map((l) => l.length)) * 7 * 1.25 + 8;
  b.ensure(headerH + 20);
  b.at({ t: "rect", x: x0, y: b.y, w: b.contentWidth, h: headerH, fill: "#e9edf2", stroke: "#888" });
  drawRow(header, 7, true, b.y + 4);
  b.y += headerH + 4;

  for (const row of rows) {
    const lines = cell(row, 8, false);
    const h = Math.max(...lines.map((l) => l.length)) * 8 * 1.25 + 5;
    b.ensure(h);
    drawRow(lines, 8, false, b.y);
    b.y += h;
    b.at({ t: "line", x1: x0, y1: b.y - 3, x2: x0 + b.contentWidth, y2: b.y - 3, width: 0.3, color: "#bbb" });
  }
  b.space(4);
}

export interface InvoiceTotals {
  lines: Array<{ net: Big; vat: Big }>;
  vatLines: Array<{ rate: string; base: Big; amount: Big }>;
  net: Big;
  vat: Big;
  gross: Big;
}

/** Totals as printed: computed from the *printed* line values (so an arithmetic error propagates consistently). */
export function invoiceTotals(inv: InvoiceSpec): InvoiceTotals {
  const lines = inv.lines.map((l) => {
    const net = new Big(l.netOverride ?? new Big(l.quantity).times(l.unitPrice).round(2));
    return { net, vat: net.times(l.vatRate ?? "21").div(100).round(2), rate: l.vatRate ?? "21" };
  });
  const byRate = new Map<string, Big>();
  for (const l of lines) byRate.set(l.rate, (byRate.get(l.rate) ?? new Big(0)).plus(l.net));
  const vatLines = [...byRate].map(([rate, base]) => ({ rate, base, amount: base.times(rate).div(100).round(2) }));
  const net = lines.reduce((s, l) => s.plus(l.net), new Big(0));
  const vat = vatLines.reduce((s, v) => s.plus(v.amount), new Big(0));
  return { lines, vatLines, net, vat, gross: net.plus(vat) };
}

export function invoicePages(inv: InvoiceSpec, buyer: CompanySpec): Page[] {
  const b = new PageBuilder();
  const half = b.contentWidth / 2 - 10;
  const top = b.y;
  const leftEnd = companyBlock(b, "FURNIZOR", inv.supplier, b.margin, half, top);
  const rightEnd = companyBlock(b, "CUMPĂRĂTOR", buyer, b.margin + half + 20, half, top);
  b.y = Math.max(leftEnd, rightEnd) + 10;

  b.text("FACTURĂ", { size: 20, bold: true, align: "center" });
  b.text(`Seria ${inv.series}  Nr. ${inv.number}`, { size: 11, bold: true, align: "center" });
  b.text(`Data emiterii: ${roDate(inv.issueDate)}     Data scadenței: ${roDate(inv.dueDate)}     Moneda: RON`, { size: 9, align: "center", gap: 4 });
  const vatRates = [...new Set(inv.lines.map((l) => l.vatRate ?? "21"))].join("%, ");
  b.text(`Cota TVA: ${vatRates}%`, { size: 9, align: "center", gap: 6 });
  if (inv.references.length > 0) {
    b.text(`Conform: ${inv.references.join("; ")}`, { size: 9, bold: true, gap: 4 });
  }

  const totals = invoiceTotals(inv);
  const w = b.contentWidth;
  table(
    b,
    [
      { title: "Nr. crt.", width: w * 0.06, align: "center" },
      { title: "Denumirea produselor sau a serviciilor", width: w * 0.35 },
      { title: "U.M.", width: w * 0.1, align: "center" },
      { title: "Cant.", width: w * 0.08, align: "right" },
      { title: "Preț unitar (fără TVA) -lei-", width: w * 0.15, align: "right" },
      { title: "Valoarea -lei-", width: w * 0.13, align: "right" },
      { title: "Valoare TVA -lei-", width: w * 0.13, align: "right" },
    ],
    inv.lines.map((l, i) => [
      String(i + 1),
      l.description,
      l.unit,
      qty(l.quantity),
      ron(l.unitPrice),
      ron(totals.lines[i]!.net),
      ron(totals.lines[i]!.vat),
    ]),
  );

  b.space(6);
  const labelX = b.margin + w * 0.5;
  const labelW = w * 0.3;
  const valueX = labelX + labelW;
  const valueW = w * 0.2;
  const totalRow = (label: string, value: string, bold = false, size = 9) => {
    b.ensure(size * 1.6);
    b.at({ t: "text", x: labelX, y: b.y, text: label, size, bold, width: labelW });
    b.at({ t: "text", x: valueX, y: b.y, text: value, size, bold, width: valueW, align: "right" });
    b.y += size * 1.6;
  };
  totalRow("Total fără TVA:", `${ron(totals.net)} lei`);
  for (const v of totals.vatLines) totalRow(`TVA ${v.rate}% (bază ${ron(v.base)}):`, `${ron(v.amount)} lei`);
  b.at({ t: "line", x1: labelX, y1: b.y, x2: valueX + valueW, y2: b.y, width: 0.8 });
  b.space(4);
  totalRow("TOTAL DE PLATĂ:", `${ron(totals.gross)} lei`, true, 11);

  b.space(18);
  b.text(`Termen de plată: ${roDate(inv.dueDate)}. Plata se va efectua prin ordin de plată în contul IBAN al furnizorului.`, { size: 8 });
  b.text("Factura circulă fără semnătură și ștampilă conform Legii 227/2015 privind Codul fiscal, art. 319 alin. (29).", { size: 7, color: GREY });
  footer(b, inv.note);
  return b.pages;
}

const DOC_TITLES: Record<string, string> = {
  contract: "CONTRACT DE FURNIZARE",
  purchase_order: "COMANDĂ FERMĂ",
  offer: "OFERTĂ DE PREȚ",
  cost_estimate: "DEVIZ OFERTĂ",
};

export function referencePages(doc: ReferenceDocSpec, buyer: CompanySpec): Page[] {
  const b = new PageBuilder();
  const title = DOC_TITLES[doc.documentType] ?? "ACORD";
  b.text(title, { size: 16, bold: true, align: "center" });
  b.text(`nr. ${doc.number} din ${roDate(doc.date)}`, { size: 11, align: "center", gap: 12 });

  const sup = doc.supplier;
  const who = (c: CompanySpec) =>
    `${c.name}, cu sediul în ${c.address}, CUI ${c.vatPayer ? "RO" : ""}${c.cui}, Reg. Com. ${c.regCom}, cont IBAN ${c.iban} deschis la ${c.bank}`;

  if (doc.documentType === "contract") {
    b.text("Între părțile contractante:", { size: 9, bold: true, gap: 2 });
    b.text(`1. ${who(sup)}, în calitate de VÂNZĂTOR (furnizor), și`, { size: 9, gap: 2 });
    b.text(`2. ${who(buyer)}, în calitate de CUMPĂRĂTOR,`, { size: 9, gap: 4 });
    b.text("a intervenit prezentul contract, cu respectarea următoarelor clauze:", { size: 9, gap: 8 });
    b.text("Art. 1. Obiectul contractului", { size: 10, bold: true });
    b.text(doc.subject, { size: 9, gap: 6 });
    b.text("Art. 2. Prețuri și cantități maxime", { size: 10, bold: true });
    b.text("Prețurile unitare sunt ferme pe toată durata contractului, exprimate în lei, fără TVA. Cantitățile reprezintă plafonul maxim contractat; livrările se pot face parțial, pe bază de comenzi.", { size: 9, gap: 4 });
  } else if (doc.documentType === "purchase_order") {
    b.text(`Furnizor: ${who(sup)}`, { size: 9, gap: 2 });
    b.text(`Beneficiar: ${who(buyer)}`, { size: 9, gap: 6 });
    b.text(`Vă rugăm să ne livrați următoarele produse, conform ofertei dumneavoastră. ${doc.subject}`, { size: 9, gap: 6 });
  } else if (doc.documentType === "offer") {
    b.text(`Ofertant: ${who(sup)}`, { size: 9, gap: 2 });
    b.text(`Către: ${who(buyer)}`, { size: 9, gap: 6 });
    b.text(`Ca urmare a solicitării dumneavoastră, vă transmitem oferta noastră pentru: ${doc.subject}`, { size: 9, gap: 6 });
  } else {
    b.text(`Executant: ${who(sup)}`, { size: 9, gap: 2 });
    b.text(`Beneficiar: ${who(buyer)}`, { size: 9, gap: 6 });
    b.text(`Obiectiv: ${doc.subject}`, { size: 9, gap: 6 });
  }

  const w = b.contentWidth;
  table(
    b,
    [
      { title: "Nr.", width: w * 0.06, align: "center" },
      { title: "Denumire articol / lucrare", width: w * 0.42 },
      { title: "U.M.", width: w * 0.09, align: "center" },
      { title: doc.documentType === "cost_estimate" ? "Cantitate" : "Cant. max.", width: w * 0.13, align: "right" },
      { title: "Preț unitar -lei-", width: w * 0.15, align: "right" },
      { title: "Valoare -lei-", width: w * 0.15, align: "right" },
    ],
    doc.terms.map((t, i) => {
      if (t.kind === "unit_item") {
        const value = t.maxQuantity ? ron(new Big(t.maxQuantity).times(t.unitPrice)) : "—";
        return [String(i + 1), t.description, t.unit, t.maxQuantity ? qty(t.maxQuantity) : "—", ron(t.unitPrice), value];
      }
      if (t.kind === "fixed_amount") return [String(i + 1), t.description, "serviciu", "1", ron(t.amount), ron(t.amount)];
      return [String(i + 1), t.description, "—", "—", "—", "—"];
    }),
  );
  const total = doc.terms.reduce((s, t) => {
    if (t.kind === "unit_item" && t.maxQuantity) return s.plus(new Big(t.maxQuantity).times(t.unitPrice));
    if (t.kind === "fixed_amount") return s.plus(t.amount);
    return s;
  }, new Big(0));
  b.text(`Valoare totală estimată: ${ron(total)} lei, la care se adaugă TVA 21%.`, { size: 9, bold: true, gap: 8 });

  const validity = `${doc.validity.from ? roDate(doc.validity.from) : "data semnării"} – ${doc.validity.to ? roDate(doc.validity.to) : "finalizarea lucrărilor"}`;
  if (doc.documentType === "contract") {
    b.text("Art. 3. Durata contractului", { size: 10, bold: true });
    b.text(`Contractul este valabil în perioada ${validity}.`, { size: 9, gap: 6 });
    b.text("Art. 4. Valoarea contractului", { size: 10, bold: true });
    b.text(
      doc.totalCap
        ? `Valoarea totală a contractului nu poate depăși ${ron(doc.totalCap)} lei fără TVA. Orice depășire necesită act adițional.`
        : "Valoarea contractului rezultă din cantitățile efectiv livrate, în limita cantităților maxime de la Art. 2.",
      { size: 9, gap: 6 },
    );
    b.text("Art. 5. Facturare și plată", { size: 10, bold: true });
    b.text(`Facturile vor menționa numărul prezentului contract (${doc.number}). Plata se face în termen de 30 de zile de la data facturii.`, { size: 9, gap: 6 });
  } else if (doc.documentType === "offer") {
    b.text(`Valabilitatea ofertei și termen de execuție: ${validity}. Plata se poate face în tranșe, pe bază de situații de lucrări.`, { size: 9, gap: 14 });
    b.text("ACCEPTAT", { size: 14, bold: true, color: "#1a5e1a" });
    b.text(`Beneficiarul ${buyer.name} acceptă prezenta ofertă în integralitate. Data: ${roDate(doc.validity.from ?? doc.date)}.`, { size: 9 });
    b.text("Semnătura: ________________", { size: 9 });
  } else if (doc.documentType === "purchase_order") {
    b.text(`Termen de livrare / valabilitate comandă: ${validity}. Livrările parțiale sunt acceptate. Vă rugăm să menționați numărul comenzii (${doc.number}) pe factură.`, { size: 9, gap: 6 });
  } else {
    b.text(`Perioada de execuție: ${validity}. Cantitățile din deviz sunt estimate; decontarea se face pe baza cantităților efectiv executate, la prețurile unitare din deviz.`, { size: 9, gap: 6 });
  }

  b.space(24);
  const half = b.contentWidth / 2;
  b.at({ t: "text", x: b.margin, y: b.y, text: doc.documentType === "cost_estimate" ? "EXECUTANT" : "FURNIZOR", size: 9, bold: true, width: half });
  b.at({ t: "text", x: b.margin + half, y: b.y, text: "BENEFICIAR", size: 9, bold: true, width: half });
  b.space(14);
  b.at({ t: "text", x: b.margin, y: b.y, text: sup.name, size: 9, width: half });
  b.at({ t: "text", x: b.margin + half, y: b.y, text: buyer.name, size: 9, width: half });
  footer(b);
  return b.pages;
}
