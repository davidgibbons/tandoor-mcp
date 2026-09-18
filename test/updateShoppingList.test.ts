import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerUpdateShoppingList } from '../src/tools/updateShoppingList.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

async function confirmAndCall(server: McpServer, args: Record<string, unknown>) {
    const preview = await callTool(server, 'update_shopping_list', args);
    const token = preview.structuredContent?.confirm_token as string;
    return callTool(server, 'update_shopping_list', { ...args, confirm: token });
}

describe('update_shopping_list tool', () => {
    it('adds an item, resolving the food and unit', async () => {
        const fetchImpl = serving({
            '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] },
            '/api/shopping-list-entry/': { id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        const result = await confirmAndCall(server, { action: 'add', food: 'egg', amount: 6 });
        expect(result.structuredContent?.applied).toBe(true);
    });

    it('checks an existing item by id, reading its name first for the preview', async () => {
        const fetchImpl = serving({
            '/api/shopping-list-entry/': { count: 1, next: null, previous: null, results: [{ id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }] },
            '/api/shopping-list-entry/9/': { id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        const result = await confirmAndCall(server, { action: 'check', item_id: 9 });
        expect(result.structuredContent?.applied).toBe(true);
    });

    it('rejects action "add" without a food argument', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        const result = await callTool(server, 'update_shopping_list', { action: 'add', amount: 1 });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/food/i);
    });
});
