import type { Hono } from 'hono';
import type { McpServer } from '@modelcontextprotocol/server';
import { buildApp } from './app.ts';
import { loadConfig } from './config/load.ts';
import type { Config } from './config/schema.ts';
import { WriteAudit } from './core/audit.ts';

/**
 * Loads config, opens the write audit log, and builds the HTTP app — the one
 * place that assembles them, so nothing downstream re-derives config or
 * re-opens the audit log from a stale closure. Throws ConfigInvalidError on
 * bad config; the caller decides what to do (index.ts logs and exits).
 */
// eslint-disable-next-line @typescript-eslint/require-await -- Promise return type is the declared interface; loadConfig/WriteAudit.open are sync
export async function bootstrap(configDir: string, buildServer: () => McpServer): Promise<{ app: Hono; audit: WriteAudit; config: Config }> {
    const config = loadConfig(configDir);
    const audit = WriteAudit.open(configDir);
    const app = buildApp({ config, buildServer });
    return { app, audit, config };
}
