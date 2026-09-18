import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerClearShoppingList } from '../src/tools/clearShoppingList.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

const LIST = {
    count: 2,
    next: null,
    previous: null,
    results: [
        { id: 1, food: { id: 10, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true },
        { id: 2, food: { id: 20, name: 'milk', food_onhand: false }, unit: null, amount: 1, checked: false }
    ]
};

describe('clear_shopping_list tool', () => {
    it('requires the destructive tier, not just safe_write', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ safe_write: true, destructive: false }));
        const preview = await callTool(server, 'clear_shopping_list', {});
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'clear_shopping_list', { confirm: token });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/permission denied/i);
    });

    it('deletes checked items and marks their foods on-hand once confirmed with destructive permission', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': LIST, '/api/shopping-list-entry/1/': null, '/api/food/10/': { id: 10, name: 'egg', food_onhand: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ destructive: true }));
        const preview = await callTool(server, 'clear_shopping_list', {});
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'clear_shopping_list', { confirm: token });
        expect(result.structuredContent?.applied).toBe(true);
        expect((result.structuredContent?.result as { removed: number[] }).removed).toEqual([1]);
    });

    it('is a no-op when nothing is checked', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': { count: 0, next: null, previous: null, results: [] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ destructive: true }));
        const result = await callTool(server, 'clear_shopping_list', {});
        expect(result.structuredContent?.noop).toBe(true);
        expect(result.structuredContent?.confirm_token).toBeUndefined();
    });
});
