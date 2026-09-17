import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetShoppingList } from '../src/tools/getShoppingList.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

const LIST = {
    count: 2, next: null, previous: null,
    results: [
        { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false },
        { id: 2, food: { id: 2, name: 'milk', food_onhand: false }, unit: { id: 1, name: 'L' }, amount: 1, checked: true }
    ]
};

describe('get_shopping_list tool', () => {
    it('returns a flat list by default', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetShoppingList(server, client);
        const result = await callTool(server, 'get_shopping_list', {});
        expect(result.structuredContent?.total_items).toBe(2);
    });

    it('groups by checked state when format is "grouped"', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetShoppingList(server, client);
        const result = await callTool(server, 'get_shopping_list', { format: 'grouped' });
        expect((result.structuredContent as { unchecked_items: unknown[]; checked_items: unknown[] }).unchecked_items).toHaveLength(1);
        expect((result.structuredContent as { unchecked_items: unknown[]; checked_items: unknown[] }).checked_items).toHaveLength(1);
    });
});
