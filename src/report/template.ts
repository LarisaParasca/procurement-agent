import type { ReportFacts } from "./facts.js";

// Deterministic Romanian wording per rule. Used as the fallback when the LLM report is unavailable
// or fails the number guard — so a report is always produced, and always correct.

const VERDICT_RO = {
  APPROVE: "✅ Recomandare: APROBARE",
  REVIEW: "⚠️ Recomandare: VERIFICARE MANUALĂ",
  REJECT: "⛔ Recomandare: RESPINGERE",
} as const;

type IssueFact = ReportFacts["issues"][number];

const line = (i: IssueFact) => (i.lineNo !== undefined ? ` (rândul ${i.lineNo})` : "");

export function describeIssueRo(i: IssueFact): string {
  const d = i.details;
  switch (i.code) {
    case "DUPLICATE_INVOICE":
      return d.kind === "exact"
        ? `Factura a mai fost primită: aceeași serie și același număr (${d.previousNumber}, din ${d.previousDate}).`
        : `Posibil duplicat: o altă factură a aceluiași furnizor, din aceeași zi și cu același total (${d.previousNumber}).`;
    case "NO_MATCHING_AGREEMENT":
      return "Nu am găsit niciun contract, comandă, ofertă sau deviz pentru această factură.";
    case "LOW_MATCH_CONFIDENCE":
      return d.level === "agreement"
        ? "Potrivirea cu documentul de referință este nesigură și trebuie confirmată."
        : `Potrivirea produsului cu articolul din documentul de referință este nesigură${line(i)}.`;
    case "CURRENCY_MISMATCH":
      return `Moneda facturii (${i.actual}) diferă de moneda din documentul de referință (${i.expected}).`;
    case "DATE_OUTSIDE_VALIDITY":
      return `Data facturii (${i.actual}) este în afara perioadei de valabilitate (${i.expected}).`;
    case "ITEM_NOT_COVERED":
      return `Articolul „${i.actual}”${line(i)} nu apare în documentul de referință (valoare ${d.net} lei).`;
    case "UNIT_PRICE_ABOVE_AGREED":
      return `Preț unitar mai mare decât cel convenit${line(i)}: ${i.actual} lei față de ${i.expected} lei (${d.overPct} peste), adică ${d.impact} lei în plus pe acest rând.`;
    case "QUANTITY_ABOVE_AGREED":
      return `Cantitate peste cea convenită${line(i)}: ${i.actual} ${d.unit} față de maximum ${i.expected} ${d.unit}.`;
    case "CUMULATIVE_THRESHOLD": {
      const scope =
        d.scope === "agreement_total"
          ? "valoarea totală a contractului"
          : `${d.scope === "term_quantity" ? "cantitatea" : "valoarea"} convenită pentru „${d.term}”`;
      return d.status === "over_cap"
        ? `Depășire cumulată: cu această factură s-a ajuns la ${d.usedAfter} din ${scope} (înainte: ${d.usedBefore}).`
        : `Atenție: cu această factură s-a ajuns la ${d.usedAfter} din ${scope} (prag de alertă ${d.level}).`;
    }
    case "PERCENTAGE_MISMATCH":
      return d.reason === "base_unknown"
        ? `Comisionul${line(i)} nu poate fi verificat: lipsește baza de calcul (${d.baseDescription}).`
        : `Comision greșit${line(i)}: ${i.actual} lei în loc de ${i.expected} lei (${d.rate} din ${d.base}; pe factură rezultă ${d.impliedRate}).`;
    case "RECURRING_AMOUNT_MISMATCH":
      return `Suma recurentă diferă${line(i)}: ${i.actual} lei în loc de ${i.expected} lei.`;
    case "RECURRING_PERIOD_INVALID":
      return d.reason === "missing"
        ? `Perioada facturată lipsește${line(i)}.`
        : `Perioada facturată${line(i)} (${i.actual}) nu corespunde contractului.`;
    case "RECURRING_PERIOD_DUPLICATE":
      return `Perioada ${i.actual}${line(i)} a fost deja facturată (factura ${d.previousInvoice}).`;
    case "ARITHMETIC_LINE":
      return `Eroare de calcul${line(i)}: cantitate × preț = ${i.expected} lei, dar pe factură scrie ${i.actual} lei (diferență ${i.delta} lei).`;
    case "ARITHMETIC_TOTALS":
      return `Totalurile nu se potrivesc (${d.check}): ar trebui ${i.expected} lei, pe factură ${i.actual} lei.`;
    case "VAT_RATE_INVALID":
      return `Cota de TVA ${i.actual}%${line(i)} nu este valabilă la data facturii (cote valabile: ${i.expected}%).`;
    default:
      return `Problemă tehnică la verificare (${i.code}); factura trebuie verificată manual.`;
  }
}

export function templateReport(f: ReportFacts): string {
  const out: string[] = [];
  out.push(`## ${VERDICT_RO[f.verdict]}`);
  out.push("");
  out.push(`**Factura ${f.invoice.number}** de la **${f.invoice.issuer}** (CUI ${f.invoice.issuerCui}), din ${f.invoice.issueDate}, total de plată **${f.invoice.totalGross} lei** (${f.invoice.totalNet} lei fără TVA).`);
  out.push("");
  out.push(
    f.agreement
      ? `Document de referință: ${f.agreement.type} **${f.agreement.reference}**, valabil ${f.agreement.validity} (${f.agreement.matchedBy}).`
      : "Document de referință: **negăsit**.",
  );
  const blocking = f.issues.filter((i) => i.severity !== "info");
  const infos = f.issues.filter((i) => i.severity === "info");
  out.push("");
  if (blocking.length === 0) {
    out.push("Nu am găsit probleme care să blocheze plata.");
  } else {
    out.push("### Ce am găsit");
    for (const i of blocking) out.push(`- ${describeIssueRo(i)}`);
  }
  if (infos.length > 0) {
    out.push("");
    out.push("### De reținut");
    for (const i of infos) out.push(`- ${describeIssueRo(i)}`);
  }
  if (f.extractionWarnings.length > 0) {
    out.push("");
    out.push("### Citirea documentului");
    out.push("Unele date nu au putut fi citite cu siguranță și trebuie verificate pe document:");
    for (const w of f.extractionWarnings) out.push(`- ${w}`);
  }
  out.push("");
  out.push("### Pasul următor");
  out.push(
    f.verdict === "APPROVE"
      ? "Factura poate merge spre aprobare. Decizia de plată rămâne a persoanei responsabile."
      : f.verdict === "REVIEW"
        ? "Verificați punctele de mai sus (cu responsabilul de achiziții sau cu furnizorul) înainte de aprobare."
        : "Nu aprobați plata. Solicitați furnizorului o factură corectată sau stornarea celei greșite.",
  );
  return out.join("\n");
}
