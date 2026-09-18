import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerDeleteMealPlan(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'delete_meal_plan',
        title: 'Delete a meal plan entry',
        description: 'Deletes one meal plan entry by id, from get_meal_plan. Cannot be undone. Previews by default.',
        inputSchema: z.object({ id: z.number().int().positive() }),
        operation: 'delete_meal_plan',
        tier: 'destructive',

        async plan({ id }): Promise<WritePlan> {
            const entry = await client.getMealPlan(id);
            const label = entry.recipe?.name ?? entry.title ?? '(untitled)';
            return {
                target: String(id),
                summary: `Delete the ${entry.meal_type.name} meal plan entry for "${label}" on ${entry.from_date.slice(0, 10)}.`,
                effects: ['Cannot be undone.'],
                args: { id }
            };
        },

        async apply(plan) {
            const { id } = plan.args as { id: number };
            await client.deleteMealPlan(id);
            return { deleted: id };
        }
    });
}
