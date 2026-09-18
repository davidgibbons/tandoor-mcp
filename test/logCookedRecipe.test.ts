import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerLogCookedRecipe } from '../src/tools/logCookedRecipe.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('log_cooked_recipe tool', () => {
    it('reads the recipe name for the preview, then logs it once confirmed', async () => {
        const fetchImpl = serving({
            '/api/recipe/1/': { id: 1, name: 'Pasta', keywords: [], steps: [] },
            '/api/cook-log/': { id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: null, created: '2026-01-01T00:00:00Z' }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerLogCookedRecipe(server, client, buildContext());

        const args = { recipe_id: 1, servings: 2, rating: 5 };
        const preview = await callTool(server, 'log_cooked_recipe', args);
        expect(preview.structuredContent?.summary).toContain('Pasta');

        const token = preview.structuredContent?.confirm_token as string;
        const result = await callTool(server, 'log_cooked_recipe', { ...args, confirm: token });
        expect(result.structuredContent?.applied).toBe(true);
        expect((result.structuredContent?.result as { id: number }).id).toBe(1);
    });
});
