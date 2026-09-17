import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { LimitSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const KIND = ['keyword', 'unit', 'food', 'meal_type'] as const;

export function registerListReferenceData(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'list_reference_data',
        {
            title: 'List reference data',
            annotations: READ_ONLY,
            description: 'Looks up Tandoor vocabulary the other tools take as input: keywords, units, foods, or meal types. Use before create_recipe/plan_meals when you need an exact spelling rather than guessing.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                kind: z.enum(KIND).describe('Which vocabulary to list.'),
                query: z.string().optional().describe('Optional search term (ignored for meal_type, which is always a short fixed list).'),
                limit: LimitSchema
            })
        },
        async ({ kind, query, limit }) => {
            const items = await fetchByKind(client, kind, query, limit);
            const shaped = applyLimit(items, limit);
            const summary = `${shaped.returned} of ${shaped.total} ${kind}(s).`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, (i: { name: string }) => i.name) }], structuredContent: shaped };
        }
    );
}

async function fetchByKind(client: TandoorClient, kind: (typeof KIND)[number], query: string | undefined, limit: number): Promise<{ id: number; name: string }[]> {
    if (kind === 'keyword') return (await client.searchKeywords(query ?? '', limit)).results;
    if (kind === 'unit') return (await client.getUnits(query, limit)).results;
    if (kind === 'food') return (await client.searchFoods(query ?? '', limit)).results;
    return (await client.getMealTypes()).results;
}
