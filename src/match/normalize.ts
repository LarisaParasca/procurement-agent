// Deterministic normalization. Both sides of every comparison go through the same function,
// so "Contract nr. CA-2026-014" on an invoice meets "CA-2026-14" in the contract.

const REFERENCE_NOISE = new Set([
  "CONTRACT", "CONTRACTUL", "CTR", "NR", "NUMAR", "NO", "COMANDA", "COMENZII",
  "PO", "OFERTA", "OFERTEI", "DEVIZ", "DEVIZUL", "DEVIZULUI", "ANEXA", "CONFORM", "CF", "REF", "LA", "AL", "DIN",
]);

export function stripDiacritics(s: string): string {
  // ș/ş, ț/ţ, ă, â, î → s, t, a, a, i
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/** "Contract nr. CA-2026-014" → "CA-2026-14". Prefix words and leading zeros don't distinguish references. */
export function normalizeReference(raw: string): string {
  const groups = stripDiacritics(raw)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((g) => g.length > 0 && !REFERENCE_NOISE.has(g))
    .map((g) => (/^\d+$/.test(g) ? String(Number(g)) : g));
  return groups.join("-");
}

const UNIT_ALIASES: Record<string, string> = {
  buc: "buc", bucata: "buc", bucati: "buc", pcs: "buc", "pc": "buc",
  sac: "sac", saci: "sac",
  kg: "kg", kilogram: "kg",
  t: "t", to: "t", tona: "t", tone: "t",
  mc: "m3", m3: "m3", "m³": "m3",
  mp: "m2", m2: "m2", "m²": "m2",
  ml: "ml", m: "m", metru: "m", metri: "m",
  l: "l", litru: "l", litri: "l",
  ora: "h", ore: "h", h: "h",
  luna: "luna", lunar: "luna", luni: "luna",
  set: "set", serviciu: "serviciu", srv: "serviciu", forfet: "serviciu", lot: "serviciu",
};

export function normalizeUnit(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = stripDiacritics(raw).toLowerCase().replace(/[.\s]/g, "");
  return UNIT_ALIASES[key] ?? key;
}

export function normalizeText(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ") // keep "42.5", drop sentence dots
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["de", "din", "si", "cu", "la", "pentru", "pt", "tip", "conform", "a", "al", "in"]);

export function tokens(s: string): Set<string> {
  return new Set(normalizeText(s).split(" ").filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

/** Dice coefficient on token sets: 1 = same words, 0 = nothing in common. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}
