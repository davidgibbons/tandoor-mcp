import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Config } from './config/schema.ts';
import { bearerFromHeader, tokenMatches } from './mcp/endpointAuth.ts';
import { logger } from './core/logger.ts';

const NAME = 'tandoor-mcp';
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Builds the HTTP surface: `/healthz` (no auth), `/mcp` (bearer-gated), and
 * an optional Host allowlist in front of both. Zero Tandoor tools registered
 * here — `buildServer` supplies the (empty, for now) `McpServer`.
 *
 * `@modelcontextprotocol/hono`'s `createMcpHonoApp` was not used: it takes no
 * handler argument at all (it only returns a bare Hono app with optional
 * DNS-rebinding Host/Origin middleware), so it contributes nothing once this
 * app implements its own Host check and bearer gate. Calling it with
 * `host: '0.0.0.0'` also logs a startup warning on every invocation, which
 * would fire on every test run for no benefit.
 */
export function buildApp(opts: { config: Config; buildServer: () => McpServer }): Hono {
    const { config } = opts;
    const handler = createMcpHandler(opts.buildServer);

    const app = new Hono();
    app.use(
        '*',
        bodyLimit({
            maxSize: MAX_BODY_BYTES,
            onError: c =>
                c.json(
                    { jsonrpc: '2.0', id: null, error: { code: -32600, message: `Request body exceeds the ${MAX_BODY_BYTES} byte limit.` } },
                    413
                )
        })
    );

    // Host allowlist runs before every route, including /healthz: a Hono
    // route that returns a response without calling next() short-circuits
    // any middleware registered after it, so this has to come first or
    // /healthz would never be gated.
    app.use('*', async (c: Context, next) => {
        const allowed = config.mcp.allowed_hosts;
        if (allowed.length === 0) return next();
        const host = (c.req.header('host') ?? '').toLowerCase();
        const bare = host.replace(/:\d{1,5}$/, '');
        if (allowed.some(a => a.toLowerCase() === host || a.toLowerCase() === bare)) return next();
        logger.warn({ host }, 'rejected request with an unlisted Host');
        return c.text('forbidden: Host not allowed', 403);
    });

    app.get('/healthz', c => c.json({ status: 'ok', name: NAME, version: process.env.TANDOOR_MCP_VERSION ?? '0.0.0-dev' }));

    app.all('/mcp', async (c: Context) => {
        const presented = bearerFromHeader(c.req.header('Authorization'));
        if (presented === undefined || !tokenMatches(presented, config.mcp.bearer_token)) {
            logger.warn({ path: '/mcp' }, 'rejected unauthenticated MCP request');
            return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="tandoor-mcp"' });
        }
        return handler.fetch(c.req.raw);
    });

    return app;
}
