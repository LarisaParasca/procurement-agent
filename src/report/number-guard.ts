// Guards the LLM-written report against invented numbers: every amount, percentage and date in the
// text must appear in the facts the code computed. One unknown number → the deterministic template is used.

const DATE_RO = /\b(\d{2})\.(\d{2})\.(\d{4})\b/g;
const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Parses "1.234,50", "1234.5", "7,6", "15" into a number. */
export function parseLooseNumber(raw: string): number {
  if (raw.includes(",")) return Number(raw.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ""));
  return Number(raw);
}

function numbersIn(text: string): { dates: string[]; numbers: number[] } {
  const dates = [...text.matchAll(DATE_RO)].map((m) => m[0]);
  const rest = text.replace(DATE_RO, " ");
  const numbers = [...rest.matchAll(NUMBER)].map((m) => parseLooseNumber(m[0])).filter((n) => Number.isFinite(n));
  return { dates, numbers };
}

export interface GuardResult {
  ok: boolean;
  unknown: string[];
}

/** Small integers (rândul 2, 2 straturi, 40 kg) are too common to police; amounts and percentages are not. */
const ALWAYS_ALLOWED_MAX = 10;

export function checkNumbers(reportText: string, facts: unknown): GuardResult {
  const factText = JSON.stringify(facts);
  const known = numbersIn(factText);
  const knownNumbers = new Set(known.numbers.map((n) => n.toFixed(2)));
  const knownDates = new Set(known.dates);
  const found = numbersIn(reportText);
  const unknown = [
    ...found.dates.filter((d) => !knownDates.has(d)),
    ...found.numbers
      .filter((n) => !(Number.isInteger(n) && n <= ALWAYS_ALLOWED_MAX) && !knownNumbers.has(n.toFixed(2)))
      .map(String),
  ];
  return { ok: unknown.length === 0, unknown };
}
