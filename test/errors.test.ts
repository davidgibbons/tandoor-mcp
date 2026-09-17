import { describe, expect, it } from 'vitest';
import { ServiceError, classifyFetchError, classifyHttpStatus } from '../src/core/errors.ts';

describe('classifyHttpStatus', () => {
    it('returns undefined for a successful status', () => {
        expect(classifyHttpStatus(200, 'https://t/api/recipe/')).toBeUndefined();
    });

    it('classifies 401 and 403 as AuthFailed with a remedy naming TANDOOR_TOKEN', () => {
        const err = classifyHttpStatus(401, 'https://t/api/recipe/');
        expect(err).toBeInstanceOf(ServiceError);
        expect(err?.kind).toBe('AuthFailed');
        expect(err?.remedy).toMatch(/TANDOOR_TOKEN/);
    });

    it('classifies a numeric-id path 404 as an item lookup failure', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/412/');
        expect(err?.kind).toBe('NotFound');
        expect(err?.remedy).toMatch(/verify it/i);
    });

    it('classifies a non-numeric-id path 404 as a wrong-base-path failure', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/');
        expect(err?.remedy).toMatch(/base path/i);
    });

    it('classifies 429 as RateLimited', () => {
        expect(classifyHttpStatus(429, 'https://t/api/recipe/')?.kind).toBe('RateLimited');
    });

    it('classifies other 4xx/5xx as UpstreamError', () => {
        expect(classifyHttpStatus(500, 'https://t/api/recipe/')?.kind).toBe('UpstreamError');
    });

    it('never includes a query string in the message', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/?token=secret');
        expect(err?.message).not.toContain('secret');
    });
});

describe('classifyFetchError', () => {
    it('classifies ECONNREFUSED as Unreachable', () => {
        const err = classifyFetchError({ cause: { code: 'ECONNREFUSED' } }, 'https://t/api/recipe/');
        expect(err.kind).toBe('Unreachable');
        expect(err.remedy).toMatch(/running/i);
    });

    it('classifies ENOTFOUND as Unreachable with a DNS remedy', () => {
        const err = classifyFetchError({ cause: { code: 'ENOTFOUND' } }, 'https://t/api/recipe/');
        expect(err.remedy).toMatch(/DNS|hostname/i);
    });

    it('classifies an AbortError as Timeout', () => {
        const err = classifyFetchError({ name: 'AbortError' }, 'https://t/api/recipe/');
        expect(err.kind).toBe('Timeout');
    });

    it('falls back to Unreachable with the underlying message for anything else', () => {
        const err = classifyFetchError(new Error('boom'), 'https://t/api/recipe/');
        expect(err.kind).toBe('Unreachable');
        expect(err.message).toContain('boom');
    });
});
