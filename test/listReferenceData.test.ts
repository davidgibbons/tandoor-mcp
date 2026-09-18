import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerListReferenceData } from '../src/tools/listReferenceData.ts';
import { callTool } from './helpers/callTool.ts';
import { serving } from './helpers/serve.ts';

describe('list_reference_data tool', () => {
    it('lists keywords', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/keyword/?query=&page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'quick' }] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerListReferenceData(server, client);
        const result = await callTool(server, 'list_reference_data', { kind: 'keyword' });
        expect(result.structuredContent?.total).toBe(1);
    });

    it('lists units', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/unit/?page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'cup' }] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerListReferenceData(server, client);
        const result = await callTool(server, 'list_reference_data', { kind: 'unit' });
        expect(result.structuredContent?.total).toBe(1);
    });

    it('lists foods', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/food/?query=&page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerListReferenceData(server, client);
        const result = await callTool(server, 'list_reference_data', { kind: 'food' });
        expect(result.structuredContent?.total).toBe(1);
    });

    it('lists meal types', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Dinner', order: 1 }] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerListReferenceData(server, client);
        const result = await callTool(server, 'list_reference_data', { kind: 'meal_type' });
        expect(result.structuredContent?.total).toBe(1);
    });

    it('projects to {id, name}, dropping internal fields Tandoor also returns', async () => {
        const client = new TandoorClient(
            'https://t.example',
            'secret',
            5000,
            serving({ '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Dinner', order: 1, created_by: 2, color: null, time: null }] } })
        );
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerListReferenceData(server, client);
        const result = await callTool(server, 'list_reference_data', { kind: 'meal_type' });
        const items = result.structuredContent?.items as unknown[];
        expect(items).toEqual([{ id: 1, name: 'Dinner' }]);
    });
});
