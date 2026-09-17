import { describe, expect, it } from 'vitest';
import { WriteAudit } from '../src/core/audit.ts';

const record = () => ({ tool: 'delete_meal_plan', operation: 'delete_meal_plan', tier: 'destructive' as const, target: '5', args: {} });

describe('WriteAudit', () => {
    it('writes an attempted row on begin and reads it back via recent()', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin(record());
        const [row] = audit.recent(1);
        expect(row?.id).toBe(id);
        expect(row?.outcome).toBe('attempted');
        audit.close();
    });

    it('settle() replaces the outcome in place rather than adding a row', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin(record());
        audit.settle(id, 'applied');
        expect(audit.recent(10)).toHaveLength(1);
        expect(audit.recent(1)[0]?.outcome).toBe('applied');
        audit.close();
    });

    it('redacts a key that looks like a secret, recursively', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin({ ...record(), args: { note: 'fine', nested: { api_key: 'shhh' } } });
        const row = audit.recent(1)[0];
        expect(row?.args).not.toContain('shhh');
        expect(row?.args).toContain('__REDACTED__');
        void id;
        audit.close();
    });
});
