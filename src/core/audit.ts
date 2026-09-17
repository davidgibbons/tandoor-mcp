import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { join } from 'node:path';
import type { WriteTier } from './permissions.ts';

export const AUDIT_FILENAME = 'audit.db';

export type WriteOutcome = 'attempted' | 'applied' | 'dry_run' | 'denied' | 'unconfirmed' | 'failed';

export type AuditRecord = {
    tool: string;
    operation: string;
    tier: WriteTier;
    target: string;
    args: Record<string, unknown>;
};

export type AuditRow = {
    id: number;
    at: string;
    tool: string;
    operation: string;
    tier: string;
    target: string;
    args: string;
    outcome: string;
    detail: string | null;
    settled_at: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS write_audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT    NOT NULL,
    tool      TEXT    NOT NULL,
    operation TEXT    NOT NULL,
    tier      TEXT    NOT NULL,
    target    TEXT    NOT NULL,
    args      TEXT    NOT NULL,
    outcome   TEXT    NOT NULL,
    detail    TEXT,
    settled_at TEXT
);
CREATE INDEX IF NOT EXISTS write_audit_at ON write_audit (at DESC);
`;

const SECRET_KEY = /(api[_-]?key|token|password|secret|authorization)/i;

const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) ? '__REDACTED__' : scrub(v)]));
    }
    return value;
};

function safeArgs(args: Record<string, unknown>): string {
    return JSON.stringify(scrub(args));
}

export class AuditUnavailableError extends Error {
    constructor(path: string, cause: unknown) {
        super(
            `the write audit log at ${path} could not be opened, so writes are refused — check the config volume is writable and not full. (${(cause as Error)?.message ?? 'unknown error'})`,
            { cause }
        );
        this.name = 'AuditUnavailableError';
    }
}

/** The write audit: every write attempt, including previews and refusals,
 *  as a durable row. See docs/security.md MCP08. */
export class WriteAudit {
    readonly #db: Db;
    readonly #path: string;

    private constructor(db: Db, path: string) {
        this.#db = db;
        this.#path = path;
    }

    static open(configDir: string): WriteAudit {
        const path = join(configDir, AUDIT_FILENAME);
        try {
            const db = new Database(path);
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = FULL');
            db.exec(SCHEMA);
            return new WriteAudit(db, path);
        } catch (err) {
            throw new AuditUnavailableError(path, err);
        }
    }

    static ephemeral(): WriteAudit {
        const db = new Database(':memory:');
        db.exec(SCHEMA);
        return new WriteAudit(db, ':memory:');
    }

    begin(record: AuditRecord): number {
        try {
            const result = this.#db
                .prepare(`INSERT INTO write_audit (at, tool, operation, tier, target, args, outcome) VALUES (?, ?, ?, ?, ?, ?, 'attempted')`)
                .run(new Date().toISOString(), record.tool, record.operation, record.tier, record.target, safeArgs(record.args));
            return Number(result.lastInsertRowid);
        } catch (err) {
            throw new AuditUnavailableError(this.#path, err);
        }
    }

    settle(id: number, outcome: Exclude<WriteOutcome, 'attempted'>, detail?: string): void {
        this.#db.prepare(`UPDATE write_audit SET outcome = ?, detail = ?, settled_at = ? WHERE id = ?`).run(outcome, detail ?? null, new Date().toISOString(), id);
    }

    recent(limit = 50): AuditRow[] {
        return this.#db.prepare(`SELECT * FROM write_audit ORDER BY id DESC LIMIT ?`).all(limit) as AuditRow[];
    }

    close(): void {
        this.#db.close();
    }
}
