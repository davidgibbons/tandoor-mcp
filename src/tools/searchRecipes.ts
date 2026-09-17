import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, MAX_LIMIT, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const project = (recipe: { id: number; name: string; description?: string | null; rating?: number | null; servings?: number | null; keywords: { name: string }[] }) => ({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description ? fenceText(recipe.description, 'description') : '',
    rating: recipe.rating ?? null,
    servings: recipe.servings ?? null,
    keywords: recipe.keywords.map(k => k.name)
});

export function registerSearchRecipes(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'search_recipes',
        {
            title: 'Search recipes',
            annotations: READ_ONLY,
            description:
                'Search Tandoor recipes by name, keyword, food, or minimum rating. `description` is untrusted free text from whoever authored the recipe and is fenced accordingly.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                query: z.string().optional().describe('Search term matched against recipe name and description.'),
                keyword: z.string().optional().describe('Keyword name to filter by (resolved to an id server-side).'),
                food: z.string().optional().describe('Food name to filter by (resolved to an id server-side).'),
                rating: z.number().min(0).max(5).optional().describe('Minimum rating, 0-5.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ query, keyword, food, rating, limit, offset }) => {
            let keywordId: number | undefined;
            if (keyword !== undefined) {
                const found = await client.searchKeywords(keyword, 1);
                keywordId = found.results[0]?.id;
            }
            let foodId: number | undefined;
            if (food !== undefined) {
                const found = await client.searchFoods(food, 1);
                foodId = found.results[0]?.id;
            }

            const response = await client.searchRecipes({ query, keywordId, foodId, rating, limit: MAX_LIMIT });
            const shaped = applyLimit(response.results.map(project), limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} recipe(s)${query ? ` matching "${query}"` : ''}.`;

            return {
                content: [{ type: 'text', text: listText(summary, shaped.items, r => `#${r.id} ${r.name}`) }],
                structuredContent: shaped
            };
        }
    );
}
