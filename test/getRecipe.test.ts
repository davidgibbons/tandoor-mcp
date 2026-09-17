import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetRecipe } from '../src/tools/getRecipe.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

const RECIPE = {
    id: 1,
    name: 'Pasta',
    description: 'Tasty',
    rating: 4,
    servings: 2,
    keywords: [],
    steps: [
        {
            id: 1,
            name: '',
            instruction: 'Boil the pasta.',
            order: 1,
            ingredients: [{ id: 1, food: { id: 1, name: 'pasta', food_onhand: false }, unit: { id: 1, name: 'g' }, amount: 200, is_header: false, no_amount: false }]
        }
    ]
};

describe('get_recipe tool', () => {
    it('returns the recipe unscaled when no servings argument is given', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/recipe/1/': RECIPE }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetRecipe(server, client);
        const result = await callTool(server, 'get_recipe', { id: 1 });
        const structured = result.structuredContent as unknown as { ingredients: Array<{ amount: number }>; scaling_applied: boolean };
        expect(structured.ingredients[0]?.amount).toBe(200);
        expect(structured.scaling_applied).toBe(false);
    });

    it('scales ingredient amounts to the requested servings', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/recipe/1/': RECIPE }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetRecipe(server, client);
        const result = await callTool(server, 'get_recipe', { id: 1, servings: 4 });
        const structured = result.structuredContent as unknown as { ingredients: Array<{ amount: number }>; scaling_applied: boolean };
        expect(structured.ingredients[0]?.amount).toBe(400);
        expect(structured.scaling_applied).toBe(true);
    });
});
