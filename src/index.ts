import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/server';
import { bootstrap } from './bootstrap.ts';
import { TandoorClient } from './client/tandoorClient.ts';
import { ConfigInvalidError } from './config/load.ts';
import type { Config } from './config/schema.ts';
import { ConfirmTokens } from './core/confirm.ts';
import { logger } from './core/logger.ts';
import type { WriteAudit } from './core/audit.ts';
import { registerAllTools } from './tools/register.ts';

const CONFIG_DIR = process.env.TANDOOR_MCP_CONFIG_DIR ?? '/config';
const VERSION = process.env.TANDOOR_MCP_VERSION ?? '0.0.0-dev';

/** host, port from a `host:port` string, stripping the port from the end
 *  (not the first colon) so an IPv6 literal like `[::1]:6061` parses right —
 *  and stripping the brackets `[::1]` itself, since Node/@hono/node-server
 *  want the bare address, not the bracketed literal. */
function parseBindAddr(addr: string): { hostname: string; port: number } {
    const match = /^(.*):(\d{1,5})$/.exec(addr);
    if (!match) throw new Error(`invalid bind_addr "${addr}", expected host:port`);
    return { hostname: (match[1] as string).replace(/^\[|\]$/g, ''), port: Number(match[2]) };
}

// These are assigned once bootstrap() resolves, below — but buildServer is
// only ever invoked lazily, per-request, by createMcpHandler (see app.ts),
// and that first request cannot arrive before serve() is called after
// bootstrap() has already returned. So by the time this closure runs, every
// one of these is set.
let config: Config;
let client: TandoorClient;
let audit: WriteAudit;
const confirm = new ConfirmTokens();

const buildServer = () => {
    const server = new McpServer(
        { name: 'tandoor-mcp', version: VERSION },
        { instructions: 'An MCP server for Tandoor Recipes.', capabilities: { tools: { listChanged: false } } }
    );
    registerAllTools(server, { client, context: { permissions: config.permissions, confirm, audit } });
    return server;
};

try {
    const bootstrapped = await bootstrap(CONFIG_DIR, buildServer);
    config = bootstrapped.config;
    audit = bootstrapped.audit;
    client = new TandoorClient(config.tandoor.url, config.tandoor.token, config.tandoor.timeout_ms);

    const { hostname, port } = parseBindAddr(config.mcp.bind_addr);
    serve({ fetch: bootstrapped.app.fetch, hostname, port }, info => {
        logger.info({ port: info.port }, 'tandoor-mcp listening');
    });
} catch (err) {
    if (err instanceof ConfigInvalidError) {
        logger.error({ detail: err.detail }, 'config.yaml is invalid — see config.example.yaml for the expected shape');
        process.exit(1);
    }
    throw err;
}
