import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerLogCookedRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'log_cooked_recipe',
        title: 'Log a cooked recipe',
        description: 'Records that a recipe was cooked: servings made, an optional rating (1-5), and an optional comment. Previews by default.',
        inputSchema: z.object({
            recipe_id: z.number().int().positive(),
            servings: z.number().positive().default(1),
            rating: z.number().int().min(1).max(5).optional(),
            comment: z.string().optional()
        }),
        operation: 'log_cooked_recipe',
        tier: 'safe',

        async plan({ recipe_id, servings, rating, comment }): Promise<WritePlan> {
            const recipe = await client.getRecipe(recipe_id);
            return {
                target: String(recipe_id),
                summary: `Log that "${recipe.name}" was cooked (${servings} serving(s)${rating !== undefined ? `, rated ${rating}/5` : ''}).`,
                effects: ['Adds one entry to the cook log.'],
                args: { recipe: recipe_id, servings, rating, comment }
            };
        },

        async apply(plan) {
            const { recipe, servings, rating, comment } = plan.args as { recipe: number; servings: number; rating?: number; comment?: string };
            return client.createCookLog({ recipe, servings, ...(rating === undefined ? {} : { rating }), ...(comment === undefined ? {} : { comment }) });
        }
    });
}
