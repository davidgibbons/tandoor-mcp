import { describe, expect, it, vi } from 'vitest';
import { CIRCUIT_COOLDOWN_MS, CIRCUIT_THRESHOLD, TandoorHttp } from '../src/core/http.ts';
import { ServiceError } from '../src/core/errors.ts';

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TandoorHttp', () => {
    it('sends the bearer token and prefixes the base URL', async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
            expect(String(url)).toBe('https://t.example/api/recipe/1/');
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            expect((init?.headers as Headers).get('authorization')).toBe('Bearer secret');
            return jsonResponse({ id: 1 });
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        const result = await http.get<{ id: number }>('/api/recipe/1/');
        expect(result.id).toBe(1);
    });

    it('classifies a non-2xx response as a ServiceError', async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'nope' }, 404));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.get('/api/recipe/999/')).rejects.toBeInstanceOf(ServiceError);
    });

    it('retries a GET once on timeout, but not a POST', async () => {
        let calls = 0;
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            }
            return jsonResponse({ ok: true });
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        const result = await http.get<{ ok: boolean }>('/api/recipe/');
        expect(result.ok).toBe(true);
        expect(calls).toBe(2);
    });

    it('does not retry a POST on timeout', async () => {
        let calls = 0;
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        });
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.post('/api/recipe/', { name: 'x' })).rejects.toBeInstanceOf(ServiceError);
        expect(calls).toBe(1);
    });

    it('treats DELETE as returning nothing, without parsing a body', async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.delete('/api/meal-plan/1/')).resolves.toBeUndefined();
    });

    it('opens the circuit breaker after CIRCUIT_THRESHOLD consecutive failures, then refuses without calling fetch', async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);

        for (let i = 0; i < CIRCUIT_THRESHOLD; i += 1) {
            await expect(http.get('/api/recipe/')).rejects.toBeInstanceOf(ServiceError);
        }
        const callsBeforeOpen = fetchImpl.mock.calls.length;

        const err = await http.get('/api/recipe/').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toMatch(/circuit breaker/);
        expect(fetchImpl.mock.calls.length).toBe(callsBeforeOpen);
    });

    it('does not count a 404 against the circuit breaker', async () => {
        // eslint-disable-next-line @typescript-eslint/require-await
        const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        for (let i = 0; i < CIRCUIT_THRESHOLD + 2; i += 1) {
            await expect(http.get('/api/recipe/999/')).rejects.toBeInstanceOf(ServiceError);
        }
        // Still calling fetch every time — a run of 404s never opened the breaker.
        expect(fetchImpl.mock.calls.length).toBe(CIRCUIT_THRESHOLD + 2);
    });
});

// Referenced so the linter does not flag an unused import if a future edit
// trims a case above.
void CIRCUIT_COOLDOWN_MS;
