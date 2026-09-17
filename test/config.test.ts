import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigInvalidError, loadConfig } from '../src/config/load.ts';

describe('loadConfig', () => {
    let dir: string;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'tandoor-mcp-config-'));
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        process.env = originalEnv;
    });

    const write = (yaml: string) => writeFileSync(join(dir, 'config.yaml'), yaml, 'utf8');

    it('loads a valid config.yaml and applies defaults', () => {
        write(`
tandoor:
  url: https://recipes.example.com
  token: abc123
mcp:
  bearer_token: ${'a'.repeat(32)}
`);
        const config = loadConfig(dir);
        expect(config.tandoor.url).toBe('https://recipes.example.com');
        expect(config.tandoor.timeout_ms).toBe(10_000);
        expect(config.mcp.bind_addr).toBe('127.0.0.1:6061');
        expect(config.mcp.allowed_hosts).toEqual([]);
        expect(config.permissions).toEqual({ safe_write: false, destructive: false });
    });

    it('rejects a config missing a required field', () => {
        write(`
tandoor:
  url: https://recipes.example.com
mcp:
  bearer_token: ${'a'.repeat(32)}
`);
        expect(() => loadConfig(dir)).toThrow(ConfigInvalidError);
    });

    it('rejects a non-http(s) tandoor url', () => {
        write(`
tandoor:
  url: ftp://recipes.example.com
  token: abc123
mcp:
  bearer_token: ${'a'.repeat(32)}
`);
        expect(() => loadConfig(dir)).toThrow(ConfigInvalidError);
    });

    it('applies environment variable overrides on top of config.yaml', () => {
        write(`
tandoor:
  url: https://recipes.example.com
  token: file-token
mcp:
  bearer_token: ${'a'.repeat(32)}
`);
        process.env.TANDOOR_TOKEN = 'env-token';
        process.env.PERMISSIONS_SAFE_WRITE = 'true';
        const config = loadConfig(dir);
        expect(config.tandoor.token).toBe('env-token');
        expect(config.permissions.safe_write).toBe(true);
    });

    it('builds config from environment variables alone, with no config.yaml present', () => {
        process.env.TANDOOR_URL = 'https://recipes.example.com';
        process.env.TANDOOR_TOKEN = 'env-token';
        process.env.MCP_BEARER_TOKEN = 'b'.repeat(40);
        const config = loadConfig(dir);
        expect(config.tandoor.url).toBe('https://recipes.example.com');
        expect(config.mcp.bearer_token).toBe('b'.repeat(40));
    });

    it('rejects a bearer token shorter than 32 characters', () => {
        process.env.TANDOOR_URL = 'https://recipes.example.com';
        process.env.TANDOOR_TOKEN = 'env-token';
        process.env.MCP_BEARER_TOKEN = 'short';
        expect(() => loadConfig(dir)).toThrow(ConfigInvalidError);
    });
});
