import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerAllTools } from '../src/tools/register.ts';
import { serving } from './helpers/serve.ts';

async function listTools(server: McpServer): Promise<{ tools: Array<{ name: string }> }> {
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await clientTransport.start();
    const response = await new Promise<{ result?: unknown }>(resolve => {
        clientTransport.onmessage = message => resolve(message as { result?: unknown });
        void clientTransport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    });
    return response.result as { tools: Array<{ name: string }> };
}

describe('registerAllTools', () => {
    it('registers exactly the 14 designed tools', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerAllTools(server, { client, context: { permissions: { safe_write: false, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() } });

        const result = await listTools(server);
        const names = result.tools.map(t => t.name).sort();
        expect(names).toEqual(
            [
                'clear_shopping_list',
                'create_recipe',
                'delete_meal_plan',
                'get_cook_log',
                'get_meal_plan',
                'get_recipe',
                'get_shopping_list',
                'list_reference_data',
                'log_cooked_recipe',
                'plan_meals',
                'search_recipes',
                'suggest_recipes',
                'update_pantry',
                'update_shopping_list'
            ].sort()
        );
    });
});
