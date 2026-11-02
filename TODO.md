# Project: invoice-check-agent — a general "invoice vs. what was agreed" AI agent

## Context
I'm building a portfolio project with two purposes:
1. To present in interviews for an "AI Automation Specialist" role at a large Romanian
   real estate developer. They build agents on the Claude ecosystem (Claude API,
   Claude Code, MCP, skills, scheduled tasks) and integrate with Microsoft 365,
   Power Automate, SQL and an ERP. They value rigorous testing (test cases, cost per
   run), documentation, process mapping, measured hours saved, and careful handling of
   sensitive data (contracts, finance).
2. To adapt for a small Romanian client that builds residential blocks and also sells and
   rents properties.

I'm strong in TypeScript and system architecture and still building reading fluency in
some areas, so explain key design decisions briefly as you go — I must be able to
present and defend them. I have an interview soon, so we work in phases and Phase 1
must be a demo-able MVP.

## The core idea
Companies check incoming invoices against "what was agreed". What was agreed lives in
very different documents: purchase orders, supplier contracts, accepted offers, cost
estimates (devize), lease contracts, brokerage contracts (contracte de intermediere),
even an email accepting an offer. Small companies often have no purchase orders at all.

The agent must be GENERAL: it converts any reference document into one canonical
"Agreement" model, then checks invoices against it with configurable rules.
Design general, implement concrete: two complete company profiles, everything else on
the roadmap.

## Canonical data model (design this carefully, it's the heart of the project)
Agreement:
- id, document type (purchase_order | contract | offer | cost_estimate | lease |
  brokerage | email_acceptance | other), source file, parties (name + CUI), currency,
  validity period, references (numbers that may appear on invoices), tolerances,
  extraction confidence, needs_human_review flag
- terms: a list of typed terms:
  - unit_item: description, unit, unit price, max quantity
  - fixed_amount: description, amount (e.g. a fixed-price service)
  - percentage: description, rate, base (e.g. 3% commission of the sale price)
  - recurring: description, amount, period, start/end (e.g. monthly rent)
Invoice: supplier/issuer, buyer, CUI, number, dates, references, line items,
VAT lines, totals.
Ledger: what has already been invoiced against each agreement/term (to catch
cumulative overruns and partial deliveries).

## Pipeline
1. Ingest a document (PDF or scanned-looking PDF in Phase 1; e-Factura XML in Phase 2).
2. Classify: is it an invoice or a reference document, and which type?
3. Extract into the canonical model using Claude with structured outputs (JSON schema),
   validated with zod. Low confidence → needs_human_review.
4. Match the invoice to its agreement: first deterministically (CUI, reference numbers,
   dates), then LLM-assisted if references are missing, returning a confidence score.
5. Run rules — deterministically in code, never by the LLM:
   - unit price above agreed price (beyond tolerance)
   - quantity above agreed quantity
   - cumulative: total invoiced across invoices exceeds the agreement/term
   - percentage term: amount ≠ rate × base
   - recurring term: wrong amount, wrong period, or same period invoiced twice
   - invoice date outside agreement validity
   - item not covered by the agreement
   - arithmetic/VAT errors (VAT rate from config, never hardcoded)
   - duplicate invoice; no matching agreement found
   The LLM's role: extraction from messy documents, fuzzy line-item matching
   (e.g. "Ciment CEM II/A-LL 42.5R" vs "ciment Portland 42.5") with confidence,
   and writing the report and email. Document this LLM-vs-code split in the README.
6. Output: verdict APPROVE / REVIEW / REJECT, a report in Romanian for a non-technical
   finance employee, and for REVIEW/REJECT a drafted (never sent) email. Human-in-the-loop:
   the agent never approves a payment by itself.

## Company profiles (configuration, not code)
A profile file (YAML or JSON, validated) defines: accepted reference document types,
active rules, tolerances, VAT config, language of reports, email tone.
Build two complete profiles:
- developer: a construction company/real estate developer — supplier contracts,
  purchase orders, accepted offers, cost estimates (devize); typical materials and
  subcontracted services; partial deliveries; cumulative overrun alerts at 80% and 100%.
- agency: a real estate agency — brokerage contracts (percentage commission on
  sale/rent), lease contracts (recurring rent), invoices issued for commissions.
Adding a new profile must require no code changes — show this in docs.

## Tech stack
- TypeScript, Node.js LTS, ES modules, strict mode.
- Anthropic TypeScript SDK. Check the current Anthropic docs for the current models and
  recommended API features rather than relying on memory. Model configurable via env.
- Send PDFs using the API's native document input; use structured outputs / tool use
  for extraction. Do NOT use assistant prefill.
- MCP server with the official MCP TypeScript SDK (stdio), exposing tools like:
  find_candidate_agreements, get_agreement, get_invoiced_to_date,
  check_duplicate_invoice, record_check_result (the only write tool).
- SQLite (better-sqlite3) behind a clean data-access layer so it can be swapped for
  SQL Server/PostgreSQL. Include the SQL schema file.
- Vitest for tests.
- A project-level .mcp.json so the same MCP server works directly in Claude Code /
  Claude Desktop (demo: "which contracts are over 80% invoiced?").

## Synthetic data (no real data anywhere)
Seed script generating realistic, clearly fictional Romanian data, with PDFs (e.g. pdfkit)
that look like real Romanian documents (CUI, nr. factură, cotă TVA, total de plată):
- developer profile: ~5 suppliers, 2 contracts, 2 purchase orders, 1 accepted offer,
  1 deviz; ~10 invoices covering: clean, price over agreed, quantity over, cumulative
  overrun across 3 partial invoices, item not covered, arithmetic error, duplicate,
  no reference (must be matched fuzzily), scanned-looking.
- agency profile: 3 brokerage contracts, 2 lease contracts; ~6 invoices covering:
  correct commission, wrong commission %, rent for wrong period, rent invoiced twice,
  invoice after contract expiry, clean.
Every invoice has a ground-truth JSON file with the expected match, issues and verdict.

## Testing & evaluation (showcase feature)
- Unit tests for the rules engine and matching (no API calls).
- `npm run eval`: run the full agent on all synthetic documents, per profile, and report:
  extraction accuracy per field, matching accuracy, issue detection
  (true/false positives/negatives), verdict accuracy.
- Cost and latency: read token usage from every API response; cost per document and per
  run (prices in a config file labeled "verify against current Anthropic pricing").
- Write reports/eval-YYYY-MM-DD.md with summary tables.

## CLI
- npm run seed
- npm run ingest -- <file>            (add a reference document)
- npm run check -- <invoice> [--profile developer|agency]
- npm run check:all -- <folder>
- npm run ledger                       (usage per agreement, alerts at 80%/100%)
- npm run eval / npm test
Terminal output must look clean — it will be demoed live.

## Security & data handling
- API key only via .env (.env.example provided); .gitignore covers .env, DB, outputs.
- MCP tools read-only except record_check_result; document least privilege.
- README section on GDPR/sensitive data: what is sent to the API, what is stored locally,
  how a real deployment should handle access, retention and permissions.

## Documentation
README.md (English, written for both a hiring manager and a business owner):
- The problem in plain language, and why "reference document" instead of
  "purchase order"
- Mermaid diagrams: manual process today vs automated flow; architecture
  (agent ↔ MCP server ↔ DB); the canonical model
- Quick start in under 5 commands
- Example report generated by the agent (one per profile)
- Eval results + cost per document
- Hours-saved estimate with a transparent, editable formula
  (documents/month × minutes per manual check × % automated)
- Limitations and honest failure modes
- Roadmap: e-Factura XML and ANAF SPV, Outlook/Microsoft Graph intake, SharePoint
  storage, Teams notifications, Power Automate trigger, ERP integration, a Claude skill
  for finance staff, scheduled daily run, monthly report
docs/adding-a-profile.md: how to adapt it to a new company with no code changes.

## Working style
- Start in plan mode: propose architecture, canonical model, folder structure and phase
  plan; wait for my approval before writing code.
- Phase 1 (MVP): canonical model + profiles, seed data for the developer profile,
  extraction, matching, rules engine, single invoice check, minimal eval, README
  skeleton with diagrams.
- Phase 2: agency profile, full evals with cost reports, ledger + cumulative alerts,
  email drafts, e-Factura XML input, polished README.
- Phase 3: .mcp.json demo, adding-a-profile guide, roadmap stubs.
- Initialize git; small meaningful commits with conventional commit messages.
- After each phase, give me a 5-line summary I could say out loud in an interview.