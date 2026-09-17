import { ServiceError, classifyFetchError, classifyHttpStatus } from './errors.ts';

export const CIRCUIT_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 60_000;

type ReadAs = 'json' | 'none';

const discard = async (response: Response): Promise<void> => {
    try {
        await response.body?.cancel();
    } catch {
        // Already consumed or already errored — nothing to release.
    }
};

/**
 * The single HTTP client every Tandoor call goes through: one bearer token,
 * one circuit breaker, one place that decides what a failure means.
 */
export class TandoorHttp {
    readonly #baseUrl: string;
    readonly #basePath: string;
    readonly #token: string;
    readonly #timeoutMs: number;
    readonly #fetch: typeof fetch;

    #consecutiveFailures = 0;
    #openedAt: number | undefined;

    constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl: typeof fetch = fetch) {
        this.#baseUrl = baseUrl;
        this.#basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
        this.#token = token;
        this.#timeoutMs = timeoutMs;
        this.#fetch = fetchImpl;
    }

    async get<T>(path: string, opts?: { timeoutMs?: number; retry?: boolean }): Promise<T> {
        return this.#request<T>('GET', path, undefined, opts?.retry ?? true, opts?.timeoutMs);
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        return this.#request<T>('POST', path, body, false);
    }

    async patch<T>(path: string, body: unknown): Promise<T> {
        return this.#request<T>('PATCH', path, body, false);
    }

    async delete(path: string): Promise<void> {
        await this.#request<unknown>('DELETE', path, undefined, false, undefined, 'none');
    }

    async #request<T>(
        method: string,
        path: string,
        body: unknown,
        retryOnTimeout: boolean,
        timeoutMs?: number,
        read: ReadAs = 'json'
    ): Promise<T> {
        if (this.#circuitOpen()) {
            throw new ServiceError('Unreachable', `circuit breaker is open after ${CIRCUIT_THRESHOLD} consecutive failures`, {
                remedy: `Not retried for ${CIRCUIT_COOLDOWN_MS / 1000}s. Fix Tandoor, then try again.`
            });
        }

        try {
            const result = await this.#attempt<T>(method, path, body, read, timeoutMs);
            this.#recordSuccess();
            return result;
        } catch (err) {
            if (retryOnTimeout && err instanceof ServiceError && err.kind === 'Timeout') {
                try {
                    const result = await this.#attempt<T>(method, path, body, read, timeoutMs);
                    this.#recordSuccess();
                    return result;
                } catch (retryErr) {
                    this.#record(retryErr);
                    throw retryErr;
                }
            }
            this.#record(err);
            throw err;
        }
    }

    #record(err: unknown): void {
        if (err instanceof ServiceError && err.kind === 'NotFound') this.#recordSuccess();
        else this.#recordFailure();
    }

    async #attempt<T>(method: string, path: string, body: unknown, read: ReadAs, timeoutMs?: number): Promise<T> {
        const url = new URL(this.#basePath + path, this.#baseUrl);
        const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${this.#token}` });
        if (body !== undefined) headers.set('content-type', 'application/json');

        const safeUrl = `${new URL(this.#baseUrl).origin}${url.pathname}`;

        let response: Response;
        try {
            response = await this.#fetch(url.toString(), {
                method,
                headers,
                signal: AbortSignal.timeout(timeoutMs ?? this.#timeoutMs),
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        } catch (err) {
            throw classifyFetchError(err, safeUrl);
        }

        const httpError = classifyHttpStatus(response.status, safeUrl);
        if (httpError) {
            await discard(response);
            throw httpError;
        }

        if (read === 'none') {
            await discard(response);
            return undefined as T;
        }

        try {
            return (await response.json()) as T;
        } catch (err) {
            throw new ServiceError('UpstreamError', `response from ${url.pathname} was not valid JSON`, { cause: err });
        }
    }

    #circuitOpen(): boolean {
        if (this.#openedAt === undefined) return false;
        if (Date.now() - this.#openedAt >= CIRCUIT_COOLDOWN_MS) {
            this.#openedAt = undefined;
            this.#consecutiveFailures = CIRCUIT_THRESHOLD - 1;
            return false;
        }
        return true;
    }

    #recordSuccess(): void {
        this.#consecutiveFailures = 0;
        this.#openedAt = undefined;
    }

    #recordFailure(): void {
        this.#consecutiveFailures += 1;
        if (this.#consecutiveFailures >= CIRCUIT_THRESHOLD && this.#openedAt === undefined) {
            this.#openedAt = Date.now();
        }
    }
}
