import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { READ_ONLY, toolInput } from '../core/shape.ts';

function project(entry: { id: number; food: { name: string; food_onhand: boolean }; unit: { name: string } | null; amount: number; checked: boolean }) {
    return { id: entry.id, food: entry.food.name, amount: entry.amount, unit: entry.unit?.name ?? null, checked: entry.checked, available: entry.food.food_onhand };
}

export function registerGetShoppingList(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_shopping_list',
        {
            title: 'Get shopping list',
            annotations: READ_ONLY,
            description: 'The current shopping list, flat or grouped by checked state.',
            inputSchema: toolInput({ format: z.enum(['flat', 'grouped']).default('flat').describe('flat: one array. grouped: split into unchecked_items and checked_items.') })
        },
        async ({ format }) => {
            const response = await client.getShoppingList();
            const items = response.results.map(project);

            if (format === 'grouped') {
                const unchecked = items.filter(i => !i.checked);
                const checked = items.filter(i => i.checked);
                const result = { unchecked_items: unchecked, checked_items: checked, total_items: response.count, format };
                return { content: [{ type: 'text', text: `${unchecked.length} unchecked, ${checked.length} checked.` }], structuredContent: result };
            }

            const result = { items, total_items: response.count, format };
            return { content: [{ type: 'text', text: `${items.length} shopping list item(s).` }], structuredContent: result };
        }
    );
}
