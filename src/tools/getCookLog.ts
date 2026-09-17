import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

function daysAgo(days: number): string {
    const date = new Date(Date.now() - days * 86_400_000);
    return date.toISOString().slice(0, 10);
}

export function registerGetCookLog(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_cook_log',
        {
            title: 'Get cook log',
            annotations: READ_ONLY,
            description: 'Cooking history, optionally filtered to one recipe and/or a lookback window.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                recipe_id: z.number().int().positive().optional().describe('Restrict to this recipe.'),
                days_back: z.number().int().min(0).default(30).describe('How many days back to look. 0 disables the date filter.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ recipe_id, days_back, limit, offset }) => {
            const opts: { recipeId?: number; fromDate?: string } = {};
            if (recipe_id !== undefined) opts.recipeId = recipe_id;
            if (days_back > 0) opts.fromDate = daysAgo(days_back);
            const response = await client.getCookLog(opts);
            const projected = response.results.map(log => ({
                id: log.id,
                recipe_id: log.recipe.id,
                recipe_name: log.recipe.name,
                servings: log.servings,
                rating: log.rating ?? null,
                comment: log.comment ? fenceText(log.comment, 'comment') : null,
                created: log.created
            }));
            const shaped = applyLimit(projected, limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} cook log entr${shaped.total === 1 ? 'y' : 'ies'}.`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, e => `${e.created.slice(0, 10)} ${e.recipe_name}${e.rating !== null ? ` (${e.rating}/5)` : ''}`) }], structuredContent: shaped };
        }
    );
}
