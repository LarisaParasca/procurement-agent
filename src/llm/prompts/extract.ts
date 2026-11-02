// Versioned prompts. Bump the version when the text changes: it is part of the cache key and is
// stored with every extraction, so results can be traced to the exact prompt that produced them.

const COMMON = `You read Romanian business documents (invoices, contracts, purchase orders, offers, cost estimates, leases, brokerage contracts) and transcribe them into JSON.

Rules:
- Transcribe what is printed. Never correct, recompute or round values — downstream code checks the arithmetic, so an error on the document must stay visible.
- Romanian number format: "1.234,50" means 1234.50. Output plain numbers with a dot decimal separator.
- Dates as YYYY-MM-DD ("20.03.2026" → "2026-03-20").
- Copy descriptions, names and reference numbers verbatim, keeping diacritics.
- CUI/CIF: copy exactly as printed, including an "RO" prefix if there is one.
- If a field is absent, use null. If you cannot read something reliably (blurred scan, cut-off text), lower the matching confidence and list it in "unreadable".
- Confidence values are 0–1: 0.95+ only when the value is clearly printed and unambiguous.`;

export const CLASSIFY_PROMPT = {
  version: "classify-v1",
  system: `${COMMON}

Task: decide whether the document is an invoice (factură) or a reference document that records what was agreed (contract, purchase order / comandă, accepted offer / ofertă, cost estimate / deviz, lease / contract de închiriere, brokerage contract / contract de intermediere, an e-mail accepting an offer), or something else.`,
  text: "Classify this document.",
};

export const INVOICE_PROMPT = {
  version: "invoice-v1",
  system: `${COMMON}

Task: extract the invoice.
- issuer = furnizor / prestator (who issued the invoice); recipient = cumpărător / beneficiar / client.
- references: every contract, order (comandă), offer (ofertă), estimate (deviz) or annex number the invoice refers to ("Conform: …", "Contract nr. …"). Empty array if none.
- lines: one entry per invoice line, in order. "net" is the line value without VAT exactly as printed.
- vatLines: one entry per VAT rate in the totals block. totals: as printed.
- For rent or other periodic lines, fill periodFrom/periodTo if the period is stated. For commission lines, percentageBase is the amount the percentage is applied to, if stated.`,
  text: "Extract this invoice.",
};

export const AGREEMENT_PROMPT = {
  version: "agreement-v1",
  system: `${COMMON}

Task: extract what was agreed, as typed terms. Choose the term kind by how the price is defined:
- unit_item: a unit price per unit of measure (sac, t, mc, mp, buc, ora…). maxQuantity = the agreed or maximum quantity (in a deviz, the estimated quantity); null if none.
- fixed_amount: a lump sum for a service or work package (preț forfetar). allowInstallments = true if payment in tranches / situații de lucrări is allowed.
- percentage: a percentage of a base, e.g. a 3% commission on the sale price. rate as a fraction (0.03).
- recurring: a periodic amount, e.g. monthly rent, with start/end dates.

Also extract:
- parties with roles (supplier/buyer for purchases; landlord/tenant for leases; agency/client for brokerage).
- references: the document's own number(s), the ones an invoice would quote.
- validFrom/validTo: the validity or execution period.
- totalCap: only an explicit ceiling ("valoarea totală nu poate depăși …"); an "estimated total" is not a cap.
- pricesIncludeVat: true only if the document says prices include VAT.`,
  text: "Extract the agreement from this document.",
};
