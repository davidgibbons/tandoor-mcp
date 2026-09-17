import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from '../src/tools/write.ts';
import { callTool } from './helpers/callTool.ts';

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return {
        permissions: { safe_write: false, destructive: false, ...overrides },
        confirm: new ConfirmTokens(),
        audit: WriteAudit.ephemeral()
    };
}

function registerTestTool(server: McpServer, context: WriteContext, apply: (id: number) => Promise<unknown>) {
    registerWriteTool(server, context, {
        name: 'delete_thing',
        title: 'Delete a thing',
        description: 'Deletes a thing by id.',
        inputSchema: z.object({ id: z.number() }),
        operation: 'delete_thing',
        tier: 'destructive',
        plan({ id }): Promise<WritePlan> {
            return Promise.resolve({ target: String(id), summary: `Delete thing ${id}.`, effects: ['Cannot be undone.'], args: { id } });
        },
        async apply(_plan, { id }) {
            return apply(id);
        }
    });
}

describe('registerWriteTool', () => {
    it('previews without applying when confirm is omitted', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        let applied = false;
        registerTestTool(server, buildContext({ destructive: true }), id => {
            applied = true;
            return Promise.resolve({ deleted: id });
        });

        const result = await callTool(server, 'delete_thing', { id: 5 });

        expect(applied).toBe(false);
        expect(result.structuredContent?.applied).toBe(false);
        expect(result.structuredContent?.confirm_token).toBeDefined();
    });

    it('applies once a valid confirm token is presented', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        let applied = false;
        registerTestTool(server, buildContext({ destructive: true }), id => {
            applied = true;
            return Promise.resolve({ deleted: id });
        });

        const preview = await callTool(server, 'delete_thing', { id: 5 });
        const token = preview.structuredContent?.confirm_token as string;

        const result = await callTool(server, 'delete_thing', { id: 5, confirm: token });

        expect(applied).toBe(true);
        expect(result.structuredContent?.applied).toBe(true);
    });

    it('refuses to apply when the permission tier is off, even with a confirm token from elsewhere', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerTestTool(server, buildContext({ destructive: false }), () => Promise.resolve({}));

        const result = await callTool(server, 'delete_thing', { id: 5 });

        expect(result.isError).toBe(true);
        expect(result.content[0]?.text).toMatch(/permission denied/i);
    });

    it('a dry_run never mutates and never issues a confirm token', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        let applied = false;
        registerTestTool(server, buildContext({ destructive: true }), id => {
            applied = true;
            return Promise.resolve({ deleted: id });
        });

        const result = await callTool(server, 'delete_thing', { id: 5, dry_run: true });

        expect(applied).toBe(false);
        expect(result.structuredContent?.confirm_token).toBeUndefined();
    });
});
