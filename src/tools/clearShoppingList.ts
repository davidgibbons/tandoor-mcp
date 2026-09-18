import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerClearShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'clear_shopping_list',
        title: 'Clear checked shopping list items',
        description:
            'Removes every checked item from the shopping list and marks the corresponding foods on-hand in the pantry. Destructive — the removed entries cannot be recovered — so it needs the `destructive` permission tier, not just `safe_write`. Previews by default.',
        inputSchema: z.object({}),
        operation: 'clear_shopping_list',
        tier: 'destructive',

        async plan(): Promise<WritePlan> {
            const list = await client.getShoppingList();
            const checked = list.results.filter(e => e.checked);
            if (checked.length === 0) {
                return { target: 'shopping-list', summary: 'No checked items to clear.', effects: [], noop: true };
            }
            return {
                target: `checked:${checked.map(e => e.id).join(',')}`,
                summary: `Clear ${checked.length} checked item(s) from the shopping list and mark those foods on-hand.`,
                effects: checked.map(e => `Deletes "${e.food.name}" and marks it on-hand in the pantry.`),
                args: { entries: checked.map(e => ({ id: e.id, foodId: e.food.id })) }
            };
        },

        async apply(plan) {
            const { entries } = plan.args as { entries: { id: number; foodId: number }[] };
            const removed: number[] = [];
            for (const entry of entries) {
                await client.deleteShoppingListEntry(entry.id);
                await client.updateFoodOnHand(entry.foodId, true);
                removed.push(entry.id);
            }
            return { removed };
        }
    });
}
