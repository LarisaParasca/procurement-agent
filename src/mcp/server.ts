import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync } from "node:fs";
import { z } from "zod";
import { env } from "../config/env.js";
import { loadProfile } from "../config/profiles.js";
import type { Repos } from "../data/repos.js";
import { createSqliteRepos } from "../data/sqlite/index.js";
import { CheckResultSchema, InvoiceSchema, type Profile } from "../domain/index.js";
import {
  checkDuplicateInvoice,
  findCandidateAgreements,
  getAgreement,
  getInvoicedToDate,
  listAgreementUsage,
  recordCheckResult,
  type ServiceContext,
} from "../services/index.js";

// MCP server (stdio) over the same services the CLI uses.
// Least privilege: read tools use a read-only DB connection; record_check_result is the only write,
// and it can only append a check result + ledger entries (never approve, delete or change agreements).
// The server holds no Anthropic key and makes no LLM calls.

if (!existsSync(env.DB_PATH)) createSqliteRepos(env.DB_PATH).close(); // create schema once so read-only open works

const profiles = new Map<string, Profile>();
const profile = (id: string) => {
  if (!profiles.has(id)) profiles.set(id, loadProfile(id));
  return profiles.get(id)!;
};

const readRepos = createSqliteRepos(env.DB_PATH, { readonly: true });
let writeRepos: Repos | undefined;
const readCtx: ServiceContext = { repos: readRepos, profile };

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (err: unknown) => ({ isError: true, content: [{ type: "text" as const, text: (err as Error).message }] });
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const profileId = z.string().optional().describe(`Company profile id (default: ${env.DEFAULT_PROFILE})`);

const server = new McpServer({ name: "invoice-check", version: "1.0.0" });

server.registerTool(
  "find_candidate_agreements",
  {
    title: "Find candidate agreements",
    description:
      "Find agreements (contracts, POs, offers, devize, leases, brokerage contracts) that could cover an invoice, scored by reference number, counterparty CUI and date validity.",
    inputSchema: {
      profileId,
      counterpartyCui: z.string().optional().describe("Counterparty CUI, digits only (no RO prefix)"),
      counterpartyName: z.string().optional().describe("Used only if CUI/reference find nothing"),
      references: z.array(z.string()).optional().describe("Reference numbers as printed on the invoice"),
      invoiceDate: z.string().optional().describe("YYYY-MM-DD"),
    },
    annotations: READ,
  },
  async (args) => {
    try {
      const { candidates } = findCandidateAgreements(readCtx, { ...args, profileId: args.profileId ?? env.DEFAULT_PROFILE });
      return json({ candidates });
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_agreement",
  {
    title: "Get agreement",
    description: "Full canonical agreement: parties, validity, references, caps and typed terms (unit_item, fixed_amount, percentage, recurring).",
    inputSchema: { agreementId: z.string().describe("Agreement id or key, e.g. DEV-CTR-02") },
    annotations: READ,
  },
  async ({ agreementId }) => {
    try {
      return json(getAgreement(readCtx, { agreementId }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "get_invoiced_to_date",
  {
    title: "Get invoiced to date",
    description: "How much has been invoiced against an agreement so far, per term (quantity and amount), with usage % and 80%/100% alerts.",
    inputSchema: { agreementId: z.string().describe("Agreement id or key"), termId: z.string().optional() },
    annotations: READ,
  },
  async (args) => {
    try {
      return json(getInvoicedToDate(readCtx, args));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "list_agreement_usage",
  {
    title: "List agreement usage",
    description:
      "All agreements with their highest usage ratio (contract total or any term), sorted by usage. Use minPct=0.8 to answer 'which contracts are over 80% invoiced?'.",
    inputSchema: { profileId, minPct: z.number().optional().describe("Only agreements at or above this ratio, e.g. 0.8") },
    annotations: READ,
  },
  async (args) => {
    try {
      return json(listAgreementUsage(readCtx, { profileId: args.profileId ?? env.DEFAULT_PROFILE, minPct: args.minPct }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "check_duplicate_invoice",
  {
    title: "Check duplicate invoice",
    description: "Whether an invoice was already received: exact (same issuer + series + number) or suspected (same issuer, gross and date).",
    inputSchema: {
      profileId,
      issuerCui: z.string(),
      number: z.string(),
      series: z.string().optional(),
      gross: z.string().optional().describe("Decimal string, e.g. 62865.30"),
      issueDate: z.string().optional(),
    },
    annotations: READ,
  },
  async (args) => {
    try {
      return json(checkDuplicateInvoice(readCtx, { ...args, profileId: args.profileId ?? env.DEFAULT_PROFILE }));
    } catch (err) {
      return fail(err);
    }
  },
);

server.registerTool(
  "record_check_result",
  {
    title: "Record check result",
    description:
      "The only write tool. Stores an invoice and its check result and appends ledger entries (status pending_review — never approved). Idempotent per invoice file and pipeline version.",
    inputSchema: { invoice: InvoiceSchema, checkResult: CheckResultSchema },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  async ({ invoice, checkResult }) => {
    try {
      writeRepos ??= createSqliteRepos(env.DB_PATH);
      return json(recordCheckResult({ repos: writeRepos, profile }, { invoice, checkResult }));
    } catch (err) {
      return fail(err);
    }
  },
);

await server.connect(new StdioServerTransport());
