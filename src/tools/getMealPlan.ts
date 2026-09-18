import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export function registerGetMealPlan(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_meal_plan',
        {
            title: 'Get meal plan',
            annotations: READ_ONLY,
            description: 'Meal plan entries for a date range, optionally filtered by meal type name (e.g. "Dinner").',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                from_date: DateSchema.describe('Start of the range, inclusive, YYYY-MM-DD.'),
                to_date: DateSchema.describe('End of the range, inclusive, YYYY-MM-DD.'),
                meal_type: z.string().optional().describe('Filter to entries whose meal type name matches, case-insensitive.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ from_date, to_date, meal_type, limit, offset }) => {
            const response = await client.getMealPlans(from_date, to_date);
            const filtered = response.results.filter(p => meal_type === undefined || p.meal_type.name.toLowerCase() === meal_type.toLowerCase());
            const projected = filtered.map(p => ({
                id: p.id,
                date: p.from_date.slice(0, 10),
                meal_type: p.meal_type.name,
                recipe_id: p.recipe?.id ?? null,
                recipe_name: p.recipe?.name ?? null,
                title: p.title ?? null,
                servings: p.servings,
                note: p.note ? fenceText(p.note, 'note') : null
            }));
            const shaped = applyLimit(projected, limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} meal plan entr${shaped.total === 1 ? 'y' : 'ies'} from ${from_date} to ${to_date}.`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, e => `${e.date} ${e.meal_type}: ${e.recipe_name ?? e.title ?? '(untitled)'}`) }], structuredContent: shaped };
        }
    );
}
