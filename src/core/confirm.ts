import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type WriteTier = 'safe' | 'destructive';

export const CONFIRM_TTL_MS = 300_000;
const MAX_CONSUMED = 10_000;

export type WriteIntent = {
    tool: string;
    tier: WriteTier;
    operation: string;
    target: string;
    args?: Record<string, unknown>;
};

export type ConfirmFailure = 'expired' | 'mismatch' | 'used' | 'malformed';
export type ConfirmResult = { ok: true } | { ok: false; failure: ConfirmFailure; remedy: string };

const REMEDY: Record<ConfirmFailure, string> = {
    expired: `The confirmation token has expired (they last ${CONFIRM_TTL_MS / 1000}s). Call this tool again without \`confirm\` for a fresh token.`,
    mismatch:
        'That confirmation token was issued for a different operation or arguments. Call this tool again without `confirm` to preview *this* operation and use the token it returns.',
    used: 'That confirmation token has already been used. Call this tool again without `confirm` if you genuinely intend to repeat the operation.',
    malformed: 'That is not a confirmation token issued by this server. Call this tool again without `confirm` to get one.'
};

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

const intentPayload = (intent: WriteIntent): string =>
    canonicalize({ tool: intent.tool, tier: intent.tier, operation: intent.operation, target: intent.target, args: intent.args ?? {} });

function unwrap(presented: string): string {
    let out = presented.trim();
    for (let previous = ''; out !== previous; ) {
        previous = out;
        out = out
            .replace(/^[`'"]+/u, '')
            .replace(/[`'"]+$/u, '')
            .replace(/[.,;:!?]+$/u, '')
            .trim();
    }
    return out;
}

function signatureMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        timingSafeEqual(b, b);
        return false;
    }
    return timingSafeEqual(a, b);
}

/** Per-call write confirmation: single-use, HMAC-bound to the exact
 *  operation, five-minute TTL. See docs/security.md MCP06. */
export class ConfirmTokens {
    readonly #key: Buffer;
    readonly #now: () => number;
    readonly #ttlMs: number;
    readonly #consumed = new Map<string, number>();

    constructor(opts: { clock?: () => number; ttlMs?: number; key?: Buffer } = {}) {
        this.#key = opts.key ?? randomBytes(32);
        this.#now = opts.clock ?? Date.now;
        this.#ttlMs = opts.ttlMs ?? CONFIRM_TTL_MS;
    }

    issue(intent: WriteIntent): string {
        const issuedAt = this.#now();
        return `v1.${issuedAt.toString(36)}.${this.#sign(intent, issuedAt)}`;
    }

    verifyAndConsume(presented: string, intent: WriteIntent): ConfirmResult {
        this.#sweep();

        const parts = unwrap(presented).split('.');
        if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, failure: 'malformed', remedy: REMEDY.malformed };

        const issuedAt = Number.parseInt(parts[1] ?? '', 36);
        const signature = parts[2] ?? '';
        if (!Number.isFinite(issuedAt) || signature === '') return { ok: false, failure: 'malformed', remedy: REMEDY.malformed };

        const age = this.#now() - issuedAt;
        if (age < 0 || age > this.#ttlMs) return { ok: false, failure: 'expired', remedy: REMEDY.expired };

        if (!signatureMatches(signature, this.#sign(intent, issuedAt))) {
            return { ok: false, failure: 'mismatch', remedy: REMEDY.mismatch };
        }

        if (this.#consumed.has(signature)) return { ok: false, failure: 'used', remedy: REMEDY.used };

        this.#consumed.set(signature, issuedAt + this.#ttlMs);
        return { ok: true };
    }

    #sign(intent: WriteIntent, issuedAt: number): string {
        return createHmac('sha256', this.#key).update(`${issuedAt}\n${intentPayload(intent)}`).digest('base64url');
    }

    #sweep(): void {
        const now = this.#now();
        for (const [signature, deadAt] of this.#consumed) {
            if (deadAt <= now) this.#consumed.delete(signature);
        }
        while (this.#consumed.size > MAX_CONSUMED) {
            const oldest = this.#consumed.keys().next().value;
            if (oldest === undefined) break;
            this.#consumed.delete(oldest);
        }
    }
}
