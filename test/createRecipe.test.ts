import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { parseIngredientLine, registerCreateRecipe, toDecimalAmount } from '../src/tools/createRecipe.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

describe('parseIngredientLine', () => {
    it('parses "amount unit food"', () => {
        expect(parseIngredientLine('2 cups flour')).toEqual({ amount: '2', unit: 'cups', food: 'flour' });
    });

    it('parses "amount food" with no unit', () => {
        expect(parseIngredientLine('2 eggs')).toEqual({ amount: '2', food: 'eggs' });
    });

    it('parses a fraction amount', () => {
        expect(parseIngredientLine('1/2 tsp salt')).toEqual({ amount: '1/2', unit: 'tsp', food: 'salt' });
    });

    it('parses a mixed-number amount', () => {
        expect(parseIngredientLine('1 1/2 cups sugar')).toEqual({ amount: '1 1/2', unit: 'cups', food: 'sugar' });
    });

    it('extracts a trailing parenthetical as a note', () => {
        expect(parseIngredientLine('2 cups flour (sifted)')).toEqual({ amount: '2', unit: 'cups', food: 'flour', note: 'sifted' });
    });

    it('defaults amount to "1" for a line with no leading number', () => {
        expect(parseIngredientLine('salt to taste')).toEqual({ amount: '1', food: 'salt to taste' });
    });
});

describe('toDecimalAmount', () => {
    it('leaves a whole or decimal number as-is', () => {
        expect(toDecimalAmount('2')).toBe('2');
        expect(toDecimalAmount('2.5')).toBe('2.5');
    });

    it('converts a fraction to a decimal', () => {
        expect(toDecimalAmount('1/2')).toBe('0.5');
    });

    it('converts a mixed number to a decimal', () => {
        expect(toDecimalAmount('1 1/2')).toBe('1.5');
    });
});

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('create_recipe tool', () => {
    it('previews without creating anything', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerCreateRecipe(server, client, buildContext({ safe_write: true }));

        const result = await callTool(server, 'create_recipe', { name: 'Pasta', ingredients_block: '200 g pasta', instructions_block: 'Boil it.' });

        expect(result.structuredContent?.applied).toBe(false);
        expect(result.structuredContent?.summary).toContain('Pasta');
    });

    it('resolves food/unit and creates the recipe once confirmed', async () => {
        const fetchImpl = serving({
            '/api/food/?query=pasta&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'pasta', food_onhand: false }] },
            '/api/unit/?query=g&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'g' }] },
            '/api/recipe/': { id: 10, name: 'Pasta', keywords: [], steps: [] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerCreateRecipe(server, client, buildContext({ safe_write: true }));

        const preview = await callTool(server, 'create_recipe', { name: 'Pasta', ingredients_block: '200 g pasta', instructions_block: 'Boil it.' });
        const token = preview.structuredContent?.confirm_token as string;

        const result = await callTool(server, 'create_recipe', {
            name: 'Pasta',
            ingredients_block: '200 g pasta',
            instructions_block: 'Boil it.',
            confirm: token
        });

        expect(result.structuredContent?.applied).toBe(true);
        expect((result.structuredContent?.result as { id: number }).id).toBe(10);
    });
});
