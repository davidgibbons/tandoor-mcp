import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerPlanMeals } from '../src/tools/planMeals.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('plan_meals tool', () => {
    it('resolves recipe name and meal type, then creates one entry per date once confirmed', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=Pasta&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Pasta', keywords: [] }] },
            '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'Dinner', order: 1 }] },
            '/api/meal-plan/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 2, name: 'Dinner', order: 1 } }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerPlanMeals(server, client, buildContext());

        const args = { recipe: 'Pasta', meal_type: 'Dinner', dates: ['2026-01-01'] };
        const preview = await callTool(server, 'plan_meals', args);
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'plan_meals', { ...args, confirm: token });

        expect(result.structuredContent?.applied).toBe(true);
        expect((result.structuredContent?.result as { created: number[] }).created).toEqual([5]);
    });

    it('fails the plan when the meal type name does not match any configured meal type', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=Pasta&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Pasta', keywords: [] }] },
            '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'Dinner', order: 1 }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerPlanMeals(server, client, buildContext());
        const result = await callTool(server, 'plan_meals', { recipe: 'Pasta', meal_type: 'Brunch', dates: ['2026-01-01'] });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/meal type/i);
    });
});
