import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerSearchRecipes } from '../src/tools/searchRecipes.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

describe('search_recipes tool', () => {
    it('returns a windowed, fenced list of recipes', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=pasta&page_size=500': {
                count: 1,
                next: null,
                previous: null,
                results: [{ id: 1, name: 'Pasta <script>', description: 'Tasty <b>bold</b>', rating: 4, servings: 2, keywords: [{ id: 3, label: 'Entree' }] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSearchRecipes(server, client);

        const result = await callTool(server, 'search_recipes', { query: 'pasta' });
        const structured = result.structuredContent as unknown as { items: Array<{ description: string; keywords: string[] }>; total: number };

        expect(structured.total).toBe(1);
        expect(structured.items[0]?.description).toContain('tandoor.description');
        expect(structured.items[0]?.description).not.toContain('<b>');
        // The recipe list endpoint nests keywords as {id, label}, not the full
        // {id, name} shape /api/recipe/{id}/ returns — confirmed against a real
        // instance. Read .label here, not .name.
        expect(structured.items[0]?.keywords).toEqual(['Entree']);
    });
});
