import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerSuggestRecipes } from '../src/tools/suggestRecipes.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

const PANTRY = {
    count: 2,
    next: null,
    previous: null,
    results: [
        { id: 1, name: 'egg', food_onhand: true },
        { id: 2, name: 'flour', food_onhand: true }
    ]
};

const CANDIDATES = {
    count: 2,
    next: null,
    previous: null,
    results: [
        { id: 10, name: 'Pancakes', keywords: [] },
        { id: 20, name: 'Sushi', keywords: [] }
    ]
};

const PANCAKES = {
    id: 10,
    name: 'Pancakes',
    keywords: [],
    servings: 4,
    steps: [
        {
            id: 1,
            name: '',
            order: 1,
            instruction: 'Mix and cook.',
            ingredients: [
                { id: 1, food: { id: 1, name: 'egg', food_onhand: true }, unit: null, amount: 2, is_header: false, no_amount: false },
                { id: 2, food: { id: 2, name: 'flour', food_onhand: true }, unit: null, amount: 200, is_header: false, no_amount: false }
            ]
        }
    ]
};

const SUSHI = {
    id: 20,
    name: 'Sushi',
    keywords: [],
    servings: 2,
    steps: [
        {
            id: 1,
            name: '',
            order: 1,
            instruction: 'Roll it.',
            ingredients: [
                { id: 1, food: { id: 3, name: 'nori', food_onhand: false }, unit: null, amount: 4, is_header: false, no_amount: false },
                { id: 2, food: { id: 4, name: 'rice', food_onhand: false }, unit: null, amount: 300, is_header: false, no_amount: false }
            ]
        }
    ]
};

describe('suggest_recipes tool', () => {
    it('ranks recipes by how much of the pantry they use', async () => {
        const fetchImpl = serving({
            '/api/food/?query=&page_size=200': PANTRY,
            '/api/recipe/?page_size=100': CANDIDATES,
            '/api/recipe/10/': PANCAKES,
            '/api/recipe/20/': SUSHI
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSuggestRecipes(server, client);
        const result = await callTool(server, 'suggest_recipes', {});
        const suggestions = result.structuredContent?.suggestions as Array<{ recipe_name: string; match_percentage: number }>;
        expect(suggestions[0]?.recipe_name).toBe('Pancakes');
        expect(suggestions[0]?.match_percentage).toBe(100);
        expect(suggestions.find(s => s.recipe_name === 'Sushi')).toBeUndefined();
    });

    it('reports no suggestions when the pantry is empty', async () => {
        const fetchImpl = serving({ '/api/food/?query=&page_size=200': { count: 0, next: null, previous: null, results: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSuggestRecipes(server, client);
        const result = await callTool(server, 'suggest_recipes', {});
        expect(result.structuredContent?.suggestions).toEqual([]);
    });
});
