import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { READ_ONLY, toolInput } from '../core/shape.ts';

const MODE = ['maximum-use', 'expiring-soon'] as const;

function shouldInclude(mode: (typeof MODE)[number], matchPercent: number, missingCount: number): boolean {
    if (mode === 'expiring-soon') return matchPercent >= 30 && missingCount <= 3;
    return matchPercent >= 50;
}

/** ponytail: sequential per-recipe detail fetch (N calls to get_recipe for N
 *  candidate recipes) rather than a batched endpoint Tandoor doesn't offer —
 *  fine for a typical home-cook-sized recipe library; add caching or
 *  parallelize if a very large library makes this slow. */
export function registerSuggestRecipes(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'suggest_recipes',
        {
            title: 'Suggest recipes from pantry',
            annotations: READ_ONLY,
            description:
                'Recommends recipes based on which foods are currently marked on-hand, ranked by what percentage of each recipe\'s ingredients you already have. `mode: "maximum-use"` (default) favors a high match; `mode: "expiring-soon"` favors a lower bar with few missing ingredients, for using up what you have soon.',
            inputSchema: toolInput({
                mode: z.enum(MODE).default('maximum-use'),
                limit: z.number().int().positive().max(50).default(10)
            })
        },
        async ({ mode, limit }) => {
            const pantryResponse = await client.searchFoods('', 200);
            const onHand = new Set(pantryResponse.results.filter(f => f.food_onhand).map(f => f.name.toLowerCase()));

            if (onHand.size === 0) {
                const result = { suggestions: [], mode, total_available: 0, message: 'No ingredients marked on-hand. Use update_pantry first.' };
                return { content: [{ type: 'text' as const, text: result.message }], structuredContent: result };
            }

            const candidates = await client.searchRecipes({ limit: 100 });
            const suggestions: { recipe_id: number; recipe_name: string; match_percentage: number; missing_ingredients: string[] }[] = [];

            for (const candidate of candidates.results) {
                const recipe = await client.getRecipe(candidate.id);
                const ingredients = recipe.steps.flatMap(s => s.ingredients).filter(i => !i.is_header && !i.no_amount);
                if (ingredients.length === 0) continue;

                const missing = ingredients.filter(i => !onHand.has(i.food.name.toLowerCase())).map(i => i.food.name);
                const matchPercentage = Math.round(((ingredients.length - missing.length) / ingredients.length) * 100);

                if (shouldInclude(mode, matchPercentage, missing.length)) {
                    suggestions.push({ recipe_id: recipe.id, recipe_name: recipe.name, match_percentage: matchPercentage, missing_ingredients: missing });
                }
            }

            suggestions.sort((a, b) => b.match_percentage - a.match_percentage);
            const top = suggestions.slice(0, limit);

            const result = { suggestions: top, mode, total_available: onHand.size, message: `Found ${top.length} recipe suggestion(s) using your ${onHand.size} on-hand ingredient(s).` };
            return { content: [{ type: 'text' as const, text: result.message }], structuredContent: result };
        }
    );
}
