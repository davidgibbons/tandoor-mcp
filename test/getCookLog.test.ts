import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetCookLog } from '../src/tools/getCookLog.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

describe('get_cook_log tool', () => {
    it('defaults days_back to 30 and converts it to a from_date filter', async () => {
        const expectedDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const routes: Record<string, object> = {};
        routes[`/api/cook-log/?from_date=${expectedDate}`] = { count: 0, next: null, previous: null, results: [] };
        const fetchImpl = serving(routes);
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetCookLog(server, client);
        const result = await callTool(server, 'get_cook_log', {});
        expect(result.structuredContent).toBeDefined();
        expect((result.structuredContent as { total: number }).total).toBe(0);
    });

    it('fences a free-text comment', async () => {
        const fetchImpl = serving({
            '/api/cook-log/?recipe=1': { count: 1, next: null, previous: null, results: [{ id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'so <b>good</b>', created: '2026-01-02T00:00:00Z' }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetCookLog(server, client);
        const result = await callTool(server, 'get_cook_log', { recipe_id: 1, days_back: 0 });
        expect(result.structuredContent).toBeDefined();
        const items = (result.structuredContent as { items: Array<{ comment: string | null }> }).items;
        expect(items[0]?.comment).toContain('tandoor.comment');
    });
});
