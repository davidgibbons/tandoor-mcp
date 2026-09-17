import { describe, expect, it } from 'vitest';
import { bearerFromHeader, tokenMatches } from '../src/mcp/endpointAuth.ts';

describe('bearerFromHeader', () => {
    it('extracts the token from a Bearer header', () => {
        expect(bearerFromHeader('Bearer abc123')).toBe('abc123');
    });

    it('is case-insensitive on the scheme', () => {
        expect(bearerFromHeader('bearer abc123')).toBe('abc123');
    });

    it('returns undefined for a missing or non-Bearer header', () => {
        expect(bearerFromHeader(undefined)).toBeUndefined();
        expect(bearerFromHeader('Basic abc123')).toBeUndefined();
    });
});

describe('tokenMatches', () => {
    it('matches identical tokens', () => {
        expect(tokenMatches('secret', 'secret')).toBe(true);
    });

    it('rejects a wrong token', () => {
        expect(tokenMatches('wrong', 'secret')).toBe(false);
    });

    it('rejects an empty presented token even against an empty expected one', () => {
        expect(tokenMatches('', '')).toBe(false);
    });
});
