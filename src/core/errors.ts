export type ServiceErrorKind =
    | 'Unreachable'
    | 'AuthFailed'
    | 'NotFound'
    | 'RateLimited'
    | 'Timeout'
    | 'PermissionDenied'
    | 'UpstreamError';

const PROSE: Record<ServiceErrorKind, string> = {
    Unreachable: 'unreachable',
    AuthFailed: 'auth failed',
    NotFound: 'not found',
    RateLimited: 'rate limited',
    Timeout: 'timed out',
    PermissionDenied: 'permission denied',
    UpstreamError: 'upstream error'
};

function formatServiceError(kind: ServiceErrorKind, detail: string, remedy?: string): string {
    const base = `tandoor ${PROSE[kind]}: ${detail}`;
    return remedy ? `${base} — ${remedy}` : base;
}

/**
 * The one error type every tool throws for a Tandoor-facing failure.
 * `.message` carries the remedy, because the MCP SDK's own dispatch loop
 * builds its error result from `.message` alone.
 */
export class ServiceError extends Error {
    readonly kind: ServiceErrorKind;
    readonly detail: string;
    readonly remedy: string | undefined;

    constructor(kind: ServiceErrorKind, detail: string, opts?: { remedy?: string; cause?: unknown }) {
        super(formatServiceError(kind, detail, opts?.remedy), opts?.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = 'ServiceError';
        this.kind = kind;
        this.detail = detail;
        this.remedy = opts?.remedy;
    }
}

function safePath(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** Tandoor's REST API is uniformly `/api/<resource>/<id>/` — the last
 *  non-empty segment is numeric for an item lookup, anything else for a
 *  collection or malformed base path. */
function classifyNotFoundPath(pathname: string): 'item' | 'collection' {
    const segments = pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    return last !== undefined && /^\d+$/.test(last) ? 'item' : 'collection';
}

const NOT_FOUND_REMEDY: Record<ReturnType<typeof classifyNotFoundPath>, string> = {
    item: 'This id does not exist in Tandoor — verify it rather than assuming the base URL is wrong.',
    collection: 'Wrong base path — check tandoor.url has no trailing path or reverse-proxy prefix.'
};

export function classifyHttpStatus(status: number, url: string): ServiceError | undefined {
    if (status < 400) return undefined;
    const pathname = safePath(url);
    const at = `HTTP ${status} at ${pathname}`;

    if (status === 401 || status === 403) {
        return new ServiceError('AuthFailed', at, {
            remedy: 'The Tandoor API token is wrong or revoked. Generate a new one in Tandoor under Settings -> API and update TANDOOR_TOKEN.'
        });
    }
    if (status === 404) {
        return new ServiceError('NotFound', at, { remedy: NOT_FOUND_REMEDY[classifyNotFoundPath(pathname)] });
    }
    if (status === 429) {
        return new ServiceError('RateLimited', at, { remedy: 'Tandoor is rate-limiting this endpoint. Wait and retry.' });
    }
    return new ServiceError('UpstreamError', at);
}

const TLS_CODES = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'
]);

export function classifyFetchError(err: unknown, url: string): ServiceError {
    const e = (err ?? {}) as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e.code ?? e.cause?.code;
    const host = safeHost(url);

    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        return new ServiceError('Timeout', `no response from ${host} within the configured timeout`, { cause: err });
    }
    if (code !== undefined && TLS_CODES.has(code)) {
        return new ServiceError('Unreachable', `TLS error (${code}) at ${host}`, {
            remedy: 'The TLS certificate could not be verified. Use http:// on the LAN, or install a trusted certificate.',
            cause: err
        });
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return new ServiceError('Unreachable', `DNS lookup failed for ${host}`, {
            remedy: 'The hostname does not resolve. Use an IP address, or check your DNS.',
            cause: err
        });
    }
    if (code === 'ECONNREFUSED') {
        return new ServiceError('Unreachable', `connection refused at ${host}`, {
            remedy: 'Nothing is listening on that port. Check Tandoor is running and tandoor.url is right.',
            cause: err
        });
    }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
        return new ServiceError('Unreachable', `could not reach ${host}`, {
            remedy: 'That address is not reachable from this host. Check the URL and network path.',
            cause: err
        });
    }

    const detail = e.cause?.message ?? e.message ?? 'unknown error';
    return new ServiceError('Unreachable', `${detail} at ${host}`, { cause: err });
}
