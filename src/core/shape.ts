import * as z from 'zod/v4';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const LimitSchema = z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Maximum items to return. Defaults to ${DEFAULT_LIMIT}, hard maximum ${MAX_LIMIT}.`);

export const OffsetSchema = z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('How many items to skip before the window `limit` returns. `total` always counts the whole list, so `offset + returned < total` means there is another page.');

export const READ_ONLY = { readOnlyHint: true } as const;

/** Every tool's arguments, refusing ones it does not have rather than
 *  silently dropping them. */
export function toolInput<T extends z.ZodRawShape>(shape: T) {
    const accepted = Object.keys(shape).sort().join(', ');
    return z.strictObject(shape, {
        error: issue =>
            issue.code === 'unrecognized_keys'
                ? `Unknown argument(s): ${issue.keys.join(', ')}. This tool accepts: ${accepted}.`
                : undefined
    });
}

export const TruncationSchema = z.looseObject({
    items: z.array(z.unknown()).describe('The window of results.'),
    total: z.number().int().describe('How many matched in total — the whole list, never the window.'),
    returned: z.number().int().describe('How many are in `items`.'),
    offset: z.number().int().describe('How many were skipped.'),
    truncated: z.boolean().describe('True when this is not the whole list.')
});

export function applyLimit<T>(items: readonly T[], limit: number, offset = 0): { items: T[]; total: number; returned: number; offset: number; truncated: boolean } {
    const effective = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
    const start = Math.max(Math.trunc(offset), 0);
    const sliced = items.slice(start, start + effective);
    return { items: sliced, total: items.length, returned: sliced.length, offset: start, truncated: sliced.length < items.length };
}

export function listText<T>(summary: string, items: readonly T[], line: (item: T) => string): string {
    const lines = items.map(item => line(item).replaceAll(/[\r\n]+/gu, ' ')).filter(text => text !== '');
    return lines.length === 0 ? summary : `${summary}\n${lines.join('\n')}`;
}
