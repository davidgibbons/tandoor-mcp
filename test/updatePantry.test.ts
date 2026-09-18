import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerUpdatePantry } from '../src/tools/updatePantry.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('update_pantry tool', () => {
    it('resolves each food and updates its on-hand flag once confirmed', async () => {
        const fetchImpl = serving({
            '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] },
            '/api/food/?query=flour&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'flour', food_onhand: true }] },
            '/api/food/1/': { id: 1, name: 'egg', food_onhand: true },
            '/api/food/2/': { id: 2, name: 'flour', food_onhand: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdatePantry(server, client, buildContext());

        const args = { items: [{ food: 'egg', available: true }, { food: 'flour', available: false }] };
        const preview = await callTool(server, 'update_pantry', args);
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'update_pantry', { ...args, confirm: token });
        expect(result.structuredContent?.applied).toBe(true);
        expect((result.structuredContent?.result as { updated: number[] }).updated).toEqual([1, 2]);
    });
});
