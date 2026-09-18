import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetMealPlan } from '../src/tools/getMealPlan.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

const PLANS = {
    count: 2, next: null, previous: null,
    results: [
        { id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: 'note <b>x</b>', from_date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } },
        { id: 2, title: null, recipe: { id: 2, name: 'Salad', keywords: [] }, servings: 1, note: null, from_date: '2026-01-02', meal_type: { id: 2, name: 'Lunch', order: 2 } }
    ]
};

describe('get_meal_plan tool', () => {
    it('returns entries in the date range', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': PLANS }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        const result = await callTool(server, 'get_meal_plan', { from_date: '2026-01-01', to_date: '2026-01-07' });
        expect(result.structuredContent?.total).toBe(2);
        expect((result.structuredContent?.items as Array<{ note?: string | null }> | undefined)?.[0]?.note).toContain('tandoor.note');
    });

    it('filters client-side by meal_type name', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': PLANS }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        const result = await callTool(server, 'get_meal_plan', { from_date: '2026-01-01', to_date: '2026-01-07', meal_type: 'dinner' });
        expect(result.structuredContent?.total).toBe(1);
    });

    it('rejects a malformed date', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        const result = await callTool(server, 'get_meal_plan', { from_date: 'not-a-date', to_date: '2026-01-07' });
        expect(result.isError).toBe(true);
    });
});
