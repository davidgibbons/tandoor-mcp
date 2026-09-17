import { describe, expect, it } from 'vitest';
import { checkPermission } from '../src/core/permissions.ts';

describe('checkPermission', () => {
    it('denies a safe write when both tiers are off', () => {
        const verdict = checkPermission({ safe_write: false, destructive: false }, 'safe');
        expect(verdict.allowed).toBe(false);
    });

    it('allows a safe write when safe_write is on', () => {
        expect(checkPermission({ safe_write: true, destructive: false }, 'safe').allowed).toBe(true);
    });

    it('allows a safe write when only destructive is on — destructive implies safe', () => {
        expect(checkPermission({ safe_write: false, destructive: true }, 'safe').allowed).toBe(true);
    });

    it('denies a destructive write when only safe_write is on', () => {
        expect(checkPermission({ safe_write: true, destructive: false }, 'destructive').allowed).toBe(false);
    });

    it('allows a destructive write when destructive is on', () => {
        expect(checkPermission({ safe_write: false, destructive: true }, 'destructive').allowed).toBe(true);
    });

    it('names the config key to change in a denial remedy', () => {
        const verdict = checkPermission({ safe_write: false, destructive: false }, 'destructive');
        expect(verdict.allowed).toBe(false);
        if (!verdict.allowed) expect(verdict.remedy).toMatch(/permissions\.destructive/);
    });
});
