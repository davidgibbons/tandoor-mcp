import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerDeleteMealPlan } from '../src/tools/deleteMealPlan.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('delete_meal_plan tool', () => {
    it('requires the destructive tier', async () => {
        const client = new TandoorClient(
            'https://t.example',
            'secret',
            5000,
            serving({ '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, from_date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } } })
        );
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerDeleteMealPlan(server, client, buildContext({ safe_write: true }));
        const preview = await callTool(server, 'delete_meal_plan', { id: 5 });
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'delete_meal_plan', { id: 5, confirm: token });
        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/permission denied/i);
    });

    it('deletes once confirmed with destructive permission', async () => {
        const fetchImpl = serving({
            '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, from_date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerDeleteMealPlan(server, client, buildContext({ destructive: true }));
        const preview = await callTool(server, 'delete_meal_plan', { id: 5 });
        expect(preview.structuredContent?.summary).toContain('Pasta');
        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'delete_meal_plan', { id: 5, confirm: token });
        expect(result.structuredContent?.applied).toBe(true);
    });
});
