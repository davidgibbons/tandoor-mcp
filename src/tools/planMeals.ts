import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { ServiceError } from '../core/errors.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

async function resolveRecipeId(client: TandoorClient, recipe: string): Promise<{ id: number; name: string }> {
    if (/^\d+$/.test(recipe)) {
        const found = await client.getRecipe(Number(recipe));
        return { id: found.id, name: found.name };
    }
    const found = await client.searchRecipes({ query: recipe, limit: 1 });
    const match = found.results[0];
    if (match === undefined) {
        throw new ServiceError('NotFound', `no recipe matching "${recipe}"`, { remedy: 'Use search_recipes to find the exact name or id first.' });
    }
    return { id: match.id, name: match.name };
}

async function resolveMealTypeId(client: TandoorClient, mealType: string): Promise<{ id: number; name: string }> {
    const types = await client.getMealTypes();
    const match = types.results.find(t => t.name.toLowerCase() === mealType.toLowerCase());
    if (match === undefined) {
        const available = types.results.map(t => t.name).join(', ');
        throw new ServiceError('NotFound', `no meal type named "${mealType}"`, { remedy: `Available meal types: ${available || '(none configured)'}.` });
    }
    return { id: match.id, name: match.name };
}

export function registerPlanMeals(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'plan_meals',
        title: 'Plan meals',
        description: 'Adds a recipe to the meal plan for one or more dates and a meal type. `recipe` may be a recipe id or a name (resolved via search — take the id from search_recipes first if there is any ambiguity). Previews by default.',
        inputSchema: z.object({
            recipe: z.string().min(1).describe('Recipe id or name.'),
            meal_type: z.string().min(1).describe('Meal type name, e.g. "Dinner" — must match an existing meal type from list_reference_data.'),
            dates: z.array(DateSchema).min(1).describe('One or more dates, YYYY-MM-DD.'),
            servings: z.number().positive().default(1).describe('Servings for each entry.'),
            title: z.string().optional().describe('Optional title override for each entry.'),
            note: z.string().optional().describe('Optional note for each entry.')
        }),
        operation: 'plan_meals',
        tier: 'safe',

        async plan({ recipe, meal_type, dates, servings, title, note }): Promise<WritePlan> {
            const resolvedRecipe = await resolveRecipeId(client, recipe);
            const resolvedMealType = await resolveMealTypeId(client, meal_type);

            return {
                target: `${resolvedRecipe.id}:${resolvedMealType.id}:${dates.join(',')}`,
                summary: `Add "${resolvedRecipe.name}" to the meal plan as ${resolvedMealType.name} on ${dates.length === 1 ? dates[0] : `${dates.length} dates`}.`,
                effects: dates.map(date => `Creates a ${resolvedMealType.name} entry on ${date} for ${resolvedRecipe.name}.`),
                args: { recipeId: resolvedRecipe.id, mealTypeId: resolvedMealType.id, dates, servings, title: title ?? null, note: note ?? null }
            };
        },

        async apply(plan) {
            const { recipeId, mealTypeId, dates, servings, title, note } = plan.args as {
                recipeId: number;
                mealTypeId: number;
                dates: string[];
                servings: number;
                title: string | null;
                note: string | null;
            };
            const created: number[] = [];
            for (const date of dates) {
                const entry = await client.createMealPlan({ recipe: recipeId, title, servings, date, meal_type: mealTypeId, note });
                created.push(entry.id);
            }
            return { created };
        }
    });
}
