import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import type { ShoppingListEntry } from '../client/types.ts';
import { ServiceError } from '../core/errors.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

async function findEntry(client: TandoorClient, itemId: number): Promise<ShoppingListEntry> {
    const list = await client.getShoppingList();
    const entry = list.results.find(e => e.id === itemId);
    if (entry === undefined) {
        throw new ServiceError('NotFound', `no shopping list item with id ${itemId}`, { remedy: 'Use get_shopping_list to find the current item ids.' });
    }
    return entry;
}

export function registerUpdateShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'update_shopping_list',
        title: 'Update shopping list',
        description:
            'Adds, checks, unchecks, or removes a shopping list item. `add` takes `food` (and optionally `amount`/`unit`); `check`/`uncheck`/`remove` take `item_id` from get_shopping_list. To clear every checked item and mark those foods on-hand, use clear_shopping_list instead — that action is destructive.',
        inputSchema: z.object({
            action: z.enum(['add', 'check', 'uncheck', 'remove']),
            food: z.string().optional().describe('Required for action "add": the food name.'),
            amount: z.number().positive().default(1).describe('Amount, for action "add".'),
            unit: z.string().optional().describe('Optional unit name, for action "add".'),
            item_id: z.number().int().positive().optional().describe('Required for check/uncheck/remove: the shopping list entry id.')
        }),
        operation: 'update_shopping_list',
        tier: 'safe',

        // Food/unit resolution for "add" happens in apply(), not here: resolveFoodId
        // creates the food when nothing matches, and plan() must never mutate.
        async plan({ action, food, amount, unit, item_id }): Promise<WritePlan> {
            if (action === 'add') {
                if (food === undefined) throw new Error('action "add" requires `food`.');
                return {
                    target: food,
                    summary: `Add ${amount}${unit ? ` ${unit}` : ''} ${food} to the shopping list.`,
                    effects: ['Creates a new shopping list entry.'],
                    args: { action, food, unit: unit ?? null, amount }
                };
            }

            if (item_id === undefined) throw new Error(`action "${action}" requires \`item_id\`.`);
            const entry = await findEntry(client, item_id);
            const verb = action === 'check' ? 'Check off' : action === 'uncheck' ? 'Uncheck' : 'Remove';
            return {
                target: String(item_id),
                summary: `${verb} "${entry.food.name}" on the shopping list.`,
                effects: [action === 'remove' ? 'Deletes the entry permanently.' : "Updates the entry's checked state."],
                args: { action, itemId: item_id }
            };
        },

        async apply(plan) {
            const args = plan.args as { action: 'add' | 'check' | 'uncheck' | 'remove'; food?: string; unit?: string | null; amount?: number; itemId?: number };
            if (args.action === 'add') {
                const resolvedFood = await client.resolveFoodId(args.food as string);
                const resolvedUnit = args.unit != null ? await client.resolveUnitId(args.unit) : null;
                return client.addShoppingListEntry({ food: resolvedFood, unit: resolvedUnit, amount: args.amount as number });
            }
            const itemId = args.itemId as number;
            if (args.action === 'check') return client.updateShoppingListEntry(itemId, { checked: true });
            if (args.action === 'uncheck') return client.updateShoppingListEntry(itemId, { checked: false });
            await client.deleteShoppingListEntry(itemId);
            return { deleted: itemId };
        }
    });
}
