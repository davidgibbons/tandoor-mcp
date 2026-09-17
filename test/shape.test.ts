import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { LimitSchema, OffsetSchema, applyLimit, listText, toolInput } from '../src/core/shape.ts';

describe('applyLimit', () => {
    it('windows items and reports total/returned/truncated', () => {
        const result = applyLimit([1, 2, 3, 4, 5], 2);
        expect(result).toEqual({ items: [1, 2], total: 5, returned: 2, offset: 0, truncated: true });
    });

    it('reports truncated: false when the window covers everything', () => {
        const result = applyLimit([1, 2], 50);
        expect(result.truncated).toBe(false);
    });

    it('starts at 0 for a negative offset rather than counting from the end', () => {
        expect(applyLimit([1, 2, 3], 10, -5).items).toEqual([1, 2, 3]);
    });

    it('clamps limit to at least 1', () => {
        expect(applyLimit([1, 2, 3], 0).items).toEqual([1]);
    });
});

describe('listText', () => {
    it('joins the summary and one line per item', () => {
        const text = listText('2 recipes', [{ name: 'A' }, { name: 'B' }], i => i.name);
        expect(text).toBe('2 recipes\nA\nB');
    });

    it('falls back to just the summary when there are no items', () => {
        expect(listText('0 recipes', [], () => 'x')).toBe('0 recipes');
    });

    it('collapses embedded newlines in a single item to one line', () => {
        const text = listText('1 item', ['a\nb'], i => i);
        expect(text).toBe('1 item\na b');
    });
});

describe('toolInput', () => {
    it('produces a strict object that refuses unknown keys with a listing message', () => {
        const schema = toolInput({ name: z.string() });
        const result = schema.safeParse({ name: 'x', bogus: 1 });
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error?.issues)).toMatch(/Unknown argument/);
        expect(JSON.stringify(result.error?.issues)).toMatch(/name/);
    });
});

describe('LimitSchema / OffsetSchema', () => {
    it('defaults limit to 50 and offset to 0', () => {
        expect(LimitSchema.parse(undefined)).toBe(50);
        expect(OffsetSchema.parse(undefined)).toBe(0);
    });

    it('rejects a limit above 500', () => {
        expect(LimitSchema.safeParse(501).success).toBe(false);
    });
});
