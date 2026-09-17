import { describe, expect, it } from 'vitest';
import { ConfirmTokens, type WriteIntent } from '../src/core/confirm.ts';

const intent = (overrides: Partial<WriteIntent> = {}): WriteIntent => ({
    tool: 'delete_meal_plan',
    tier: 'destructive',
    operation: 'delete_meal_plan',
    target: '5',
    ...overrides
});

describe('ConfirmTokens', () => {
    it('issues a token that verifies and consumes for the same intent', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        expect(tokens.verifyAndConsume(token, intent())).toEqual({ ok: true });
    });

    it('rejects a token used twice', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        tokens.verifyAndConsume(token, intent());
        const second = tokens.verifyAndConsume(token, intent());
        expect(second).toMatchObject({ ok: false, failure: 'used' });
    });

    it('rejects a token issued for a different target', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent({ target: '5' }));
        const result = tokens.verifyAndConsume(token, intent({ target: '9' }));
        expect(result).toMatchObject({ ok: false, failure: 'mismatch' });
    });

    it('rejects an expired token', () => {
        let now = 0;
        const tokens = new ConfirmTokens({ clock: () => now, ttlMs: 1000 });
        const token = tokens.issue(intent());
        now = 2000;
        expect(tokens.verifyAndConsume(token, intent())).toMatchObject({ ok: false, failure: 'expired' });
    });

    it('rejects a malformed token', () => {
        const tokens = new ConfirmTokens();
        expect(tokens.verifyAndConsume('not-a-real-token', intent())).toMatchObject({ ok: false, failure: 'malformed' });
    });

    it('tolerates surrounding backticks and trailing punctuation', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        expect(tokens.verifyAndConsume(`\`${token}\`.`, intent())).toEqual({ ok: true });
    });
});
