import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ulid } from "ulid";
import {
  AgreementSchema,
  CheckResultSchema,
  InvoiceSchema,
  type Agreement,
  type CheckResult,
  type Invoice,
  type LedgerEntry,
} from "../../domain/index.js";
import type { DuplicateHit } from "../../rules/types.js";
import type { Repos } from "../repos.js";

const SCHEMA_PATH = resolve(import.meta.dirname, "../../../db/schema.sql");

export interface SqliteOptions {
  readonly?: boolean;
}

/** Opens (and if needed creates) the database. `:memory:` works for tests and evals. */
export function createSqliteRepos(path: string, opts: SqliteOptions = {}): Repos {
  if (path !== ":memory:" && !opts.readonly) mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path, { readonly: opts.readonly ?? false, fileMustExist: opts.readonly ?? false });
  if (!opts.readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  }

  const now = () => new Date().toISOString();
  const parseAgreement = (row: { document_json: string } | undefined) =>
    row ? AgreementSchema.parse(JSON.parse(row.document_json)) : undefined;
  const parseAgreements = (rows: Array<{ document_json: string }>) => rows.map((r) => parseAgreement(r)!);

  const toHit = (r: { id: string; series: string | null; number: string; issue_date: string; gross: string }): DuplicateHit => ({
    invoiceId: r.id,
    series: r.series ?? undefined,
    number: r.number,
    issueDate: r.issue_date,
    gross: r.gross,
  });

  const repos: Repos = {
    agreements: {
      upsert(input: Agreement) {
        return db.transaction(() => {
          // Re-ingesting the same file replaces the previous extraction but keeps its id,
          // so ledger entries that point at it stay valid.
          const existing = db
            .prepare("SELECT id FROM agreements WHERE id = ? OR (profile_id = ? AND source_sha256 = ?)")
            .get(input.id, input.profileId, input.source.sha256) as { id: string } | undefined;
          const a = existing ? { ...input, id: existing.id } : input;
          if (existing) {
            for (const table of ["agreement_parties", "agreement_references", "agreement_terms"]) {
              db.prepare(`DELETE FROM ${table} WHERE agreement_id = ?`).run(a.id);
            }
          }
          const values = [
            a.key ?? null, a.profileId, a.documentType, a.source.path, a.source.sha256, a.currency,
            a.validity.from ?? null, a.validity.to ?? null, a.totalCap ?? null, a.status,
            a.extraction.needsHumanReview ? 1 : 0, a.extraction.confidence, JSON.stringify(a),
          ];
          if (existing) {
            db.prepare(
              `UPDATE agreements SET agreement_key = ?, profile_id = ?, document_type = ?, source_path = ?, source_sha256 = ?,
                 currency = ?, valid_from = ?, valid_to = ?, total_cap = ?, status = ?, needs_human_review = ?,
                 confidence = ?, document_json = ? WHERE id = ?`,
            ).run(...values, a.id);
          } else {
            db.prepare(
              `INSERT INTO agreements (agreement_key, profile_id, document_type, source_path, source_sha256, currency,
                 valid_from, valid_to, total_cap, status, needs_human_review, confidence, document_json, id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(...values, a.id, now());
          }
          const party = db.prepare("INSERT OR IGNORE INTO agreement_parties (agreement_id, role, name, cui) VALUES (?, ?, ?, ?)");
          for (const p of a.parties) party.run(a.id, p.role, p.name, p.cui);
          const ref = db.prepare("INSERT INTO agreement_references (agreement_id, kind, raw, normalized) VALUES (?, ?, ?, ?)");
          for (const r of a.references) ref.run(a.id, r.kind, r.raw, r.normalized);
          const term = db.prepare(
            `INSERT INTO agreement_terms (agreement_id, term_id, kind, description, unit, unit_price, max_quantity, amount, rate, period)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const t of a.terms) {
            term.run(
              a.id, t.id, t.kind, t.description,
              t.kind === "unit_item" ? t.unit : null,
              t.kind === "unit_item" ? t.unitPrice : null,
              t.kind === "unit_item" ? (t.maxQuantity ?? null) : null,
              t.kind === "fixed_amount" || t.kind === "recurring" ? t.amount : null,
              t.kind === "percentage" ? t.rate : null,
              t.kind === "recurring" ? t.period : null,
            );
          }
          return a.id;
        })();
      },
      get: (id) => parseAgreement(db.prepare("SELECT document_json FROM agreements WHERE id = ?").get(id) as never),
      getByKey: (key) => parseAgreement(db.prepare("SELECT document_json FROM agreements WHERE agreement_key = ?").get(key) as never),
      list(profileId, opts = {}) {
        const rows = opts.status
          ? db.prepare("SELECT document_json FROM agreements WHERE profile_id = ? AND status = ? ORDER BY agreement_key, id").all(profileId, opts.status)
          : db.prepare("SELECT document_json FROM agreements WHERE profile_id = ? ORDER BY agreement_key, id").all(profileId);
        return parseAgreements(rows as never);
      },
      findByPartyCui(profileId, cui) {
        const rows = db
          .prepare(
            `SELECT DISTINCT a.document_json, a.id FROM agreements a JOIN agreement_parties p ON p.agreement_id = a.id
             WHERE a.profile_id = ? AND p.cui = ? ORDER BY a.id`,
          )
          .all(profileId, cui);
        return parseAgreements(rows as never);
      },
      findByReference(profileId, refs) {
        if (refs.length === 0) return [];
        const placeholders = refs.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT DISTINCT a.document_json, a.id FROM agreements a JOIN agreement_references r ON r.agreement_id = a.id
             WHERE a.profile_id = ? AND r.normalized IN (${placeholders}) ORDER BY a.id`,
          )
          .all(profileId, ...refs);
        return parseAgreements(rows as never);
      },
    },

    invoices: {
      insert(inv: Invoice) {
        db.transaction(() => {
          db.prepare(
            `INSERT INTO invoices (id, profile_id, source_path, source_sha256, issuer_cui, recipient_cui, series, number,
               issue_date, currency, net, vat, gross, direction, document_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            inv.id, inv.profileId, inv.source.path, inv.source.sha256, inv.issuer.cui, inv.recipient.cui,
            inv.series ?? null, inv.number, inv.issueDate, inv.currency, inv.totals.net, inv.totals.vat,
            inv.totals.gross, inv.direction, JSON.stringify(inv), now(),
          );
          const line = db.prepare(
            `INSERT INTO invoice_lines (invoice_id, line_no, description, unit, quantity, unit_price, net, vat_rate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const l of inv.lines) line.run(inv.id, l.lineNo, l.description, l.unit ?? null, l.quantity, l.unitPrice, l.net, l.vatRate);
        })();
      },
      get(id) {
        const row = db.prepare("SELECT document_json FROM invoices WHERE id = ?").get(id) as { document_json: string } | undefined;
        return row ? InvoiceSchema.parse(JSON.parse(row.document_json)) : undefined;
      },
      findBySourceSha(profileId, sha) {
        const row = db
          .prepare("SELECT document_json FROM invoices WHERE profile_id = ? AND source_sha256 = ? ORDER BY created_at LIMIT 1")
          .get(profileId, sha) as { document_json: string } | undefined;
        return row ? InvoiceSchema.parse(JSON.parse(row.document_json)) : undefined;
      },
      findDuplicates(profileId, q) {
        const exclude = q.excludeInvoiceId ?? "";
        // Series and number are compared concatenated: "FT 1001" and series "FT" + number "1001" are the same invoice.
        const key = `${q.series ?? ""}${q.number}`.replace(/[\s\-/]/g, "").toUpperCase();
        const sameIssuer = db
          .prepare("SELECT id, series, number, issue_date, gross FROM invoices WHERE profile_id = ? AND issuer_cui = ? AND id <> ?")
          .all(profileId, q.issuerCui, exclude) as Array<{ id: string; series: string | null; number: string; issue_date: string; gross: string }>;
        const exact = sameIssuer.filter((r) => `${r.series ?? ""}${r.number}`.replace(/[\s\-/]/g, "").toUpperCase() === key);
        const suspected =
          q.gross && q.issueDate
            ? sameIssuer.filter((r) => !exact.includes(r) && Number(r.gross) === Number(q.gross) && r.issue_date === q.issueDate)
            : [];
        return { exact: exact.map(toHit), suspected: suspected.map(toHit) };
      },
    },

    ledger: {
      insertMany(entries: LedgerEntry[]) {
        const stmt = db.prepare(
          `INSERT INTO ledger_entries (id, agreement_id, term_id, invoice_id, invoice_number, issuer_cui, quantity, net,
             currency, period_from, period_to, status, recorded_at, check_result_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const e of entries) {
          stmt.run(
            e.id, e.agreementId, e.termId, e.invoiceId, e.invoiceNumber, e.issuerCui, e.quantity ?? null, e.net,
            e.currency, e.period?.from ?? null, e.period?.to ?? null, e.status, e.recordedAt, e.checkResultId,
          );
        }
      },
      deleteForInvoice(invoiceId) {
        db.prepare("DELETE FROM ledger_entries WHERE invoice_id = ?").run(invoiceId);
      },
      forAgreement(agreementId, opts = {}) {
        const rows = db
          .prepare(
            `SELECT * FROM ledger_entries WHERE agreement_id = ? AND (? IS NULL OR term_id = ?) AND invoice_id <> ?
             ORDER BY recorded_at, id`,
          )
          .all(agreementId, opts.termId ?? null, opts.termId ?? null, opts.excludeInvoiceId ?? "") as Array<Record<string, string | null>>;
        return rows.map(
          (r): LedgerEntry => ({
            id: r.id!,
            agreementId: r.agreement_id!,
            termId: r.term_id ?? null,
            invoiceId: r.invoice_id!,
            invoiceNumber: r.invoice_number!,
            issuerCui: r.issuer_cui!,
            quantity: r.quantity ?? undefined,
            net: r.net!,
            currency: r.currency as LedgerEntry["currency"],
            period: r.period_from && r.period_to ? { from: r.period_from, to: r.period_to } : undefined,
            status: r.status as LedgerEntry["status"],
            recordedAt: r.recorded_at!,
            checkResultId: r.check_result_id!,
          }),
        );
      },
    },

    checkResults: {
      insert(r: CheckResult) {
        db.transaction(() => {
          db.prepare(
            `INSERT INTO check_results (id, invoice_id, profile_id, pipeline_version, agreement_id, match_method,
               match_confidence, verdict, total_cost_usd, result_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            r.id, r.invoiceId, r.profileId, r.pipelineVersion, r.match.agreementId, r.match.method, r.match.confidence,
            r.verdict, r.usage.totalCostUsd, JSON.stringify(r), r.createdAt,
          );
          const issue = db.prepare(
            `INSERT INTO issues (check_result_id, seq, code, severity, line_no, term_id, expected, actual)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          r.issues.forEach((i, seq) =>
            issue.run(r.id, seq, i.code, i.severity, i.lineNo ?? null, i.termId ?? null, i.expected ?? null, i.actual ?? null),
          );
        })();
      },
      get(id) {
        const row = db.prepare("SELECT result_json FROM check_results WHERE id = ?").get(id) as { result_json: string } | undefined;
        return row ? CheckResultSchema.parse(JSON.parse(row.result_json)) : undefined;
      },
      latestForInvoice(invoiceId) {
        const row = db
          .prepare("SELECT result_json FROM check_results WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1")
          .get(invoiceId) as { result_json: string } | undefined;
        return row ? CheckResultSchema.parse(JSON.parse(row.result_json)) : undefined;
      },
      findByInvoiceSha(profileId, sha, pipelineVersion) {
        const row = db
          .prepare(
            `SELECT c.result_json FROM check_results c JOIN invoices i ON i.id = c.invoice_id
             WHERE c.profile_id = ? AND i.source_sha256 = ? AND c.pipeline_version = ? ORDER BY c.created_at DESC LIMIT 1`,
          )
          .get(profileId, sha, pipelineVersion) as { result_json: string } | undefined;
        return row ? CheckResultSchema.parse(JSON.parse(row.result_json)) : undefined;
      },
    },

    usage: {
      insert(c) {
        db.prepare(
          `INSERT INTO llm_calls (id, task, model, document_sha256, input_tokens, output_tokens, cache_read_tokens,
             cache_write_tokens, cost_usd, latency_ms, cached, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          ulid(), c.task, c.model, c.documentSha256 ?? null, c.inputTokens, c.outputTokens, c.cacheReadTokens,
          c.cacheWriteTokens, c.costUsd, Math.round(c.latencyMs), c.cached ? 1 : 0, now(),
        );
      },
    },

    transaction: <T>(fn: () => T): T => db.transaction(fn)(),
    close: () => db.close(),
  };
  return repos;
}
