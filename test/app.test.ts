import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Config } from '../src/config/schema.ts';

const config: Config = {
    tandoor: { url: 'https://t.example', token: 'x', timeout_ms: 10_000 },
    mcp: { bearer_token: 'a'.repeat(32), bind_addr: '127.0.0.1:6061', allowed_hosts: [] },
    permissions: { safe_write: false, destructive: false }
};

const buildServer = () => new McpServer({ name: 'tandoor-mcp', version: '0.0.0-test' }, { capabilities: { tools: {} } });

describe('buildApp', () => {
    it('answers /healthz without authentication', async () => {
        const app = buildApp({ config, buildServer });
        const res = await app.request('/healthz');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('ok');
    });

    it('rejects /mcp with no Authorization header', async () => {
        const app = buildApp({ config, buildServer });
        const res = await app.request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(res.status).toBe(401);
    });

    it('rejects /mcp with the wrong bearer token', async () => {
        const app = buildApp({ config, buildServer });
        const res = await app.request('/mcp', { method: 'POST', headers: { Authorization: 'Bearer wrong' } });
        expect(res.status).toBe(401);
    });

    it('rejects a request with a Host header not on allowed_hosts, when the list is non-empty', async () => {
        const app = buildApp({ config: { ...config, mcp: { ...config.mcp, allowed_hosts: ['recipes.internal'] } }, buildServer });
        const res = await app.request('/healthz', { headers: { host: 'evil.example' } });
        expect(res.status).toBe(403);
    });

    it('allows any Host when allowed_hosts is empty', async () => {
        const app = buildApp({ config, buildServer });
        const res = await app.request('/healthz', { headers: { host: 'anything.example' } });
        expect(res.status).toBe(200);
    });
});
