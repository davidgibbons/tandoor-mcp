import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerUpdatePantry(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'update_pantry',
        title: 'Update pantry',
        description: 'Batch-marks foods as on-hand or not on-hand, resolving each food name by search-or-create. Previews by default.',
        inputSchema: z.object({
            items: z.array(z.object({ food: z.string().min(1), available: z.boolean() })).min(1).describe('Foods to update.')
        }),
        operation: 'update_pantry',
        tier: 'safe',

        // Food resolution happens in apply(): resolveFoodId creates the food
        // when nothing matches, and plan() must never mutate.
        plan({ items }): Promise<WritePlan> {
            return Promise.resolve({
                target: items.map(i => i.food).join(','),
                summary: `Update pantry availability for ${items.length} food(s).`,
                effects: items.map(i => `Mark "${i.food}" as ${i.available ? 'on-hand' : 'not on-hand'}.`),
                args: { items }
            });
        },

        async apply(plan) {
            const { items } = plan.args as { items: { food: string; available: boolean }[] };
            const updated: number[] = [];
            for (const item of items) {
                const food = await client.resolveFoodId(item.food);
                await client.updateFoodOnHand(food.id, item.available);
                updated.push(food.id);
            }
            return { updated };
        }
    });
}
