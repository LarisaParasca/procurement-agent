import type { CompanySpec, DatasetSpec, InvoiceSpec, ReferenceDocSpec } from "../spec.js";

// Developer profile dataset — ALL companies, people and numbers are fictional.
// Expected issues/verdicts below are hand-derived from the profile (tolerance 2% on unit price,
// alerts at 80%/100%), independent of the rules code.

const buyer: CompanySpec = {
  name: "Constructii Exemplu SRL",
  cui: "40000000",
  vatPayer: true,
  regCom: "J12/0001/2020",
  address: "Str. Demonstrației nr. 1, Cluj-Napoca, jud. Cluj",
  iban: "RO00EXMP0000000000000001",
  bank: "Banca Exemplu SA",
};

const materiale: CompanySpec = {
  name: "Materiale Ficțiune Construct SRL",
  cui: "38123450",
  vatPayer: true,
  regCom: "J12/1843/2017",
  address: "Calea Inventată nr. 48, Florești, jud. Cluj",
  iban: "RO00EXMP0000000000000101",
  bank: "Banca Exemplu SA",
};

const otel: CompanySpec = {
  name: "Oțel Demo Distribuție SRL",
  cui: "29145670",
  vatPayer: true,
  regCom: "J05/0921/2012",
  address: "Str. Laminorului Fictiv nr. 7, Oradea, jud. Bihor",
  iban: "RO00EXMP0000000000000202",
  bank: "Banca Model SA",
};

const betoane: CompanySpec = {
  name: "Betoane Exemplu SA",
  cui: "17654328",
  vatPayer: true,
  regCom: "J12/0412/2005",
  address: "DN1 km 482 (fictiv), Gilău, jud. Cluj",
  iban: "RO00EXMP0000000000000303",
  bank: "Banca Exemplu SA",
};

const instalatii: CompanySpec = {
  name: "Instalații Test SRL",
  cui: "42319871",
  vatPayer: true,
  regCom: "J12/5530/2020",
  address: "Str. Siguranței Imaginare nr. 3, Cluj-Napoca, jud. Cluj",
  iban: "RO00EXMP0000000000000404",
  bank: "Banca Model SA",
};

const finisaje: CompanySpec = {
  name: "Finisaje Model SRL",
  cui: "33490219",
  vatPayer: true,
  regCom: "J26/0777/2014",
  address: "Bd. Fictiv nr. 21, Turda, jud. Cluj",
  iban: "RO00EXMP0000000000000505",
  bank: "Banca Exemplu SA",
};

const references: ReferenceDocSpec[] = [
  {
    key: "DEV-CTR-01",
    file: "references/DEV-CTR-01_contract_materiale.pdf",
    documentType: "contract",
    number: "CA-2026-014",
    date: "2026-01-15",
    supplier: materiale,
    validity: { from: "2026-01-15", to: "2026-12-31" },
    subject: "Furnizarea de lianți și adezivi pentru șantierul Ansamblul Rezidențial Exemplu (bloc C1, C2), cu livrare la șantier.",
    terms: [
      { id: "t1", kind: "unit_item", description: "Ciment Portland CEM II 42.5R, sac 40 kg", aliases: [], unit: "sac", unitPrice: "31.50", maxQuantity: "2000" },
      { id: "t2", kind: "unit_item", description: "Ciment Portland CEM II 32.5R, sac 40 kg", aliases: [], unit: "sac", unitPrice: "27.80", maxQuantity: "1000" },
      { id: "t3", kind: "unit_item", description: "Var hidratat, sac 20 kg", aliases: [], unit: "sac", unitPrice: "18.40", maxQuantity: "500" },
      { id: "t4", kind: "unit_item", description: "Adeziv gresie flexibil C2TE, sac 25 kg", aliases: [], unit: "sac", unitPrice: "42.00", maxQuantity: "400" },
    ],
  },
  {
    key: "DEV-CTR-02",
    file: "references/DEV-CTR-02_contract_betoane.pdf",
    documentType: "contract",
    number: "CB-2026-007",
    date: "2026-02-01",
    supplier: betoane,
    validity: { from: "2026-02-01", to: "2026-09-30" },
    totalCap: "250000",
    subject: "Furnizarea de beton marfă și servicii de pompare pentru structura blocului C1, cu livrări parțiale conform graficului de turnare.",
    terms: [
      { id: "t1", kind: "unit_item", description: "Beton C25/30, clasa de expunere XC2", aliases: [], unit: "mc", unitPrice: "465.00", maxQuantity: "400" },
      { id: "t2", kind: "unit_item", description: "Beton C16/20", aliases: [], unit: "mc", unitPrice: "410.00", maxQuantity: "120" },
      { id: "t3", kind: "unit_item", description: "Pompare beton cu autopompă", aliases: [], unit: "ora", unitPrice: "350.00", maxQuantity: "80" },
    ],
  },
  {
    key: "DEV-PO-01",
    file: "references/DEV-PO-01_comanda_otel.pdf",
    documentType: "purchase_order",
    number: "PO-2026-0031",
    date: "2026-02-25",
    supplier: otel,
    validity: { from: "2026-03-01", to: "2026-06-30" },
    subject: "Armături pentru fundații și planșee, bloc C1.",
    terms: [
      { id: "t1", kind: "unit_item", description: "Oțel beton PC52 Ø12", aliases: [], unit: "t", unitPrice: "4180.00", maxQuantity: "25" },
      { id: "t2", kind: "unit_item", description: "Oțel beton PC52 Ø16", aliases: [], unit: "t", unitPrice: "4150.00", maxQuantity: "18" },
      { id: "t3", kind: "unit_item", description: "Plasă sudată Ø6 100x100", aliases: [], unit: "buc", unitPrice: "165.00", maxQuantity: "300" },
    ],
  },
  {
    key: "DEV-PO-02",
    file: "references/DEV-PO-02_comanda_bca.pdf",
    documentType: "purchase_order",
    number: "PO-2026-0045",
    date: "2026-03-28",
    supplier: materiale,
    validity: { from: "2026-04-01", to: "2026-08-31" },
    subject: "Materiale pentru zidărie, bloc C1 etajele 1–4.",
    terms: [
      { id: "t1", kind: "unit_item", description: "Bloc BCA 625x250x300 mm, densitate 500", aliases: [], unit: "mc", unitPrice: "395.00", maxQuantity: "180" },
      { id: "t2", kind: "unit_item", description: "Mortar pentru zidărie BCA, sac 25 kg", aliases: [], unit: "sac", unitPrice: "33.00", maxQuantity: "250" },
    ],
  },
  {
    key: "DEV-OF-01",
    file: "references/DEV-OF-01_oferta_instalatii.pdf",
    documentType: "offer",
    number: "OF-118/2026",
    date: "2026-03-10",
    supplier: instalatii,
    validity: { from: "2026-03-15", to: "2026-12-31" },
    subject: "execuția instalației electrice interioare a blocului C1 (subantrepriză), inclusiv tablourile electrice de apartament.",
    terms: [
      { id: "t1", kind: "fixed_amount", description: "Execuție instalație electrică bloc C1, conform proiect E-12/2026", aliases: [], amount: "186000.00", allowInstallments: true },
      { id: "t2", kind: "unit_item", description: "Tablou electric de apartament, echipat", aliases: [], unit: "buc", unitPrice: "1450.00", maxQuantity: "48" },
    ],
  },
  {
    key: "DEV-DV-01",
    file: "references/DEV-DV-01_deviz_finisaje.pdf",
    documentType: "cost_estimate",
    number: "DV-07/2026",
    date: "2026-03-25",
    supplier: finisaje,
    validity: { from: "2026-04-01", to: "2026-11-30" },
    subject: "Lucrări de finisaje interioare, bloc C1 (manoperă și materiale mărunte).",
    terms: [
      { id: "t1", kind: "unit_item", description: "Tencuială mecanizată interioară pe bază de ipsos", aliases: [], unit: "mp", unitPrice: "38.00", maxQuantity: "6500" },
      { id: "t2", kind: "unit_item", description: "Montaj gresie și faianță (manoperă)", aliases: [], unit: "mp", unitPrice: "62.00", maxQuantity: "2100" },
      { id: "t3", kind: "unit_item", description: "Glet de ipsos și vopsea lavabilă, 2 straturi", aliases: [], unit: "mp", unitPrice: "29.00", maxQuantity: "7000" },
    ],
  },
];

const invoices: InvoiceSpec[] = [
  {
    id: "I01", order: 1, scenario: "clean",
    file: "invoices/I01_otel_clean.pdf",
    supplier: otel, series: "OTD", number: "0145", issueDate: "2026-03-20", dueDate: "2026-04-19",
    references: ["Comanda nr. PO-2026-0031"],
    lines: [
      { description: "Oțel beton PC52 Ø12", unit: "t", quantity: "8.5", unitPrice: "4180.00", termId: "t1" },
      { description: "Plasă sudată Ø6 100x100", unit: "buc", quantity: "100", unitPrice: "165.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-PO-01", expectedIssues: [], expectedVerdict: "APPROVE",
  },
  {
    // 33.90 vs agreed 31.50 = +7.6%, tolerance 2%. Line 1 also needs fuzzy matching (42.5R vs 32.5R terms).
    id: "I02", order: 2, scenario: "price over agreed",
    file: "invoices/I02_materiale_price_over.pdf",
    supplier: materiale, series: "MFC", number: "2026-0311", issueDate: "2026-03-25", dueDate: "2026-04-24",
    references: ["Contract nr. CA-2026-014"],
    lines: [
      { description: "Ciment CEM II/A-LL 42.5R", unit: "sac", quantity: "400", unitPrice: "33.90", termId: "t1" },
      { description: "Var hidratat, sac 20 kg", unit: "sac", quantity: "100", unitPrice: "18.40", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-CTR-01",
    expectedIssues: [{ code: "UNIT_PRICE_ABOVE_AGREED", severity: "review", lineNo: 1 }],
    expectedVerdict: "REVIEW",
  },
  {
    // 20 t of Ø16 against a 18 t maximum: per-invoice quantity rule and cumulative cap both fire.
    id: "I03", order: 3, scenario: "quantity over agreed",
    file: "invoices/I03_otel_quantity_over.pdf",
    supplier: otel, series: "OTD", number: "0162", issueDate: "2026-04-10", dueDate: "2026-05-10",
    references: ["PO-2026-0031"],
    lines: [{ description: "Oțel beton PC52 Ø16", unit: "t", quantity: "20", unitPrice: "4150.00", termId: "t2" }],
    expectedAgreementKey: "DEV-PO-01",
    expectedIssues: [
      { code: "QUANTITY_ABOVE_AGREED", severity: "review", lineNo: 1 },
      { code: "CUMULATIVE_THRESHOLD", severity: "review" },
    ],
    expectedVerdict: "REVIEW",
  },
  {
    // Partial delivery 1/3: C25/30 at 45% of 400 mc, contract at 36% of 250.000.
    id: "I04", order: 4, scenario: "cumulative 1/3 (partial delivery)",
    file: "invoices/I04_betoane_partial_1.pdf",
    supplier: betoane, series: "BEX", number: "1021", issueDate: "2026-03-10", dueDate: "2026-04-09",
    references: ["Contract nr. CB-2026-007"],
    lines: [
      { description: "Beton C25/30, clasa de expunere XC2", unit: "mc", quantity: "180", unitPrice: "465.00", termId: "t1" },
      { description: "Pompare beton cu autopompă", unit: "ora", quantity: "20", unitPrice: "350.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-CTR-02", expectedIssues: [], expectedVerdict: "APPROVE",
  },
  {
    // Partial 2/3: C25/30 reaches 340/400 = 85% → 80% alert (info only, still APPROVE).
    id: "I05", order: 5, scenario: "cumulative 2/3 (80% alert)",
    file: "invoices/I05_betoane_partial_2.pdf",
    supplier: betoane, series: "BEX", number: "1088", issueDate: "2026-04-12", dueDate: "2026-05-12",
    references: ["Contract nr. CB-2026-007"],
    lines: [
      { description: "Beton C25/30, clasa de expunere XC2", unit: "mc", quantity: "160", unitPrice: "465.00", termId: "t1" },
      { description: "Pompare beton cu autopompă", unit: "ora", quantity: "18", unitPrice: "350.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-CTR-02",
    expectedIssues: [{ code: "CUMULATIVE_THRESHOLD", severity: "info" }],
    expectedVerdict: "APPROVE",
  },
  {
    // Partial 3/3: C25/30 430/400 = 107.5% (over cap → review); contract total 246.600/250.000 = 98.6% (info).
    id: "I06", order: 6, scenario: "cumulative 3/3 (overrun)",
    file: "invoices/I06_betoane_partial_3.pdf",
    supplier: betoane, series: "BEX", number: "1142", issueDate: "2026-05-15", dueDate: "2026-06-14",
    references: ["Contract nr. CB-2026-007"],
    lines: [
      { description: "Beton C25/30, clasa de expunere XC2", unit: "mc", quantity: "90", unitPrice: "465.00", termId: "t1" },
      { description: "Beton C16/20", unit: "mc", quantity: "60", unitPrice: "410.00", termId: "t2" },
      { description: "Pompare beton cu autopompă", unit: "ora", quantity: "25", unitPrice: "350.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-CTR-02",
    expectedIssues: [
      { code: "CUMULATIVE_THRESHOLD", severity: "review" },
      { code: "CUMULATIVE_THRESHOLD", severity: "info" },
    ],
    expectedVerdict: "REVIEW",
  },
  {
    id: "I07", order: 7, scenario: "item not covered",
    file: "invoices/I07_finisaje_item_not_covered.pdf",
    supplier: finisaje, series: "FM", number: "077", issueDate: "2026-05-20", dueDate: "2026-06-19",
    references: ["Deviz nr. DV-07/2026"],
    lines: [
      { description: "Tencuială mecanizată interioară pe bază de ipsos", unit: "mp", quantity: "1200", unitPrice: "38.00", termId: "t1" },
      { description: "Transport și evacuare moloz", unit: "serviciu", quantity: "1", unitPrice: "2800.00", termId: null },
    ],
    expectedAgreementKey: "DEV-DV-01",
    expectedIssues: [{ code: "ITEM_NOT_COVERED", severity: "review", lineNo: 2 }],
    expectedVerdict: "REVIEW",
  },
  {
    // Line 2: 12 × 1.450,00 = 17.400,00 but 17.940,00 is printed (digits swapped). Totals follow the wrong line.
    id: "I08", order: 8, scenario: "arithmetic error",
    file: "invoices/I08_instalatii_arithmetic.pdf",
    supplier: instalatii, series: "IT", number: "0034", issueDate: "2026-05-28", dueDate: "2026-06-27",
    references: ["Oferta nr. OF-118/2026"],
    lines: [
      { description: "Execuție instalație electrică bloc C1 — situație de lucrări nr. 1 (40%)", unit: "serviciu", quantity: "1", unitPrice: "74400.00", termId: "t1" },
      { description: "Tablou electric de apartament, echipat", unit: "buc", quantity: "12", unitPrice: "1450.00", netOverride: "17940.00", termId: "t2" },
    ],
    expectedAgreementKey: "DEV-OF-01",
    expectedIssues: [{ code: "ARITHMETIC_LINE", severity: "reject", lineNo: 2 }],
    expectedVerdict: "REJECT",
  },
  {
    // Same invoice as I01, re-sent by e-mail (different file, same series + number).
    id: "I09", order: 9, scenario: "duplicate",
    file: "invoices/I09_otel_duplicate.pdf",
    supplier: otel, series: "OTD", number: "0145", issueDate: "2026-03-20", dueDate: "2026-04-19",
    references: ["Comanda nr. PO-2026-0031"],
    note: "Copie retransmisă prin e-mail la solicitarea beneficiarului",
    lines: [
      { description: "Oțel beton PC52 Ø12", unit: "t", quantity: "8.5", unitPrice: "4180.00", termId: "t1" },
      { description: "Plasă sudată Ø6 100x100", unit: "buc", quantity: "100", unitPrice: "165.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-PO-01",
    expectedIssues: [{ code: "DUPLICATE_INVOICE", severity: "reject" }],
    expectedVerdict: "REJECT",
  },
  {
    // No reference printed. The supplier has a contract AND a PO → CUI alone is a tie; the LLM must pick the PO
    // from the line items, and match "Blocuri BCA" / "Mortar adeziv" to the PO terms.
    id: "I10", order: 10, scenario: "no reference (fuzzy match)",
    file: "invoices/I10_materiale_no_reference.pdf",
    supplier: materiale, series: "MFC", number: "2026-0387", issueDate: "2026-05-06", dueDate: "2026-06-05",
    references: [],
    lines: [
      { description: "Blocuri BCA 625x250x300", unit: "mc", quantity: "42", unitPrice: "395.00", termId: "t1" },
      { description: "Mortar adeziv pt. zidărie BCA 25kg", unit: "sac", quantity: "120", unitPrice: "33.00", termId: "t2" },
    ],
    expectedAgreementKey: "DEV-PO-02", expectedIssues: [], expectedVerdict: "APPROVE",
  },
  {
    id: "I11", order: 11, scenario: "scanned-looking (clean)",
    file: "invoices/I11_finisaje_scanned.pdf",
    supplier: finisaje, series: "FM", number: "091", issueDate: "2026-06-18", dueDate: "2026-07-18",
    references: ["Deviz nr. DV-07/2026"],
    scanned: true,
    lines: [
      { description: "Montaj gresie și faianță (manoperă)", unit: "mp", quantity: "450", unitPrice: "62.00", termId: "t2" },
      { description: "Glet de ipsos și vopsea lavabilă, 2 straturi", unit: "mp", quantity: "2000", unitPrice: "29.00", termId: "t3" },
    ],
    expectedAgreementKey: "DEV-DV-01", expectedIssues: [], expectedVerdict: "APPROVE",
  },
];

export const developerDataset: DatasetSpec = { profileId: "developer", buyer, references, invoices };
