import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema, type Config } from './schema.ts';

export class ConfigInvalidError extends Error {
    readonly detail: string;
    constructor(detail: string) {
        super(`config.yaml is invalid: ${detail}`);
        this.name = 'ConfigInvalidError';
        this.detail = detail;
    }
}

/**
 * Environment overrides applied on top of config.yaml, matching the table in
 * the design spec. Each entry is a dotted path into the raw config object and
 * a coercion for values that arrive as strings.
 */
const ENV_OVERRIDES: ReadonlyArray<{ env: string; path: readonly string[]; coerce?: (raw: string) => unknown }> = [
    { env: 'TANDOOR_URL', path: ['tandoor', 'url'] },
    { env: 'TANDOOR_TOKEN', path: ['tandoor', 'token'] },
    { env: 'TANDOOR_TIMEOUT_MS', path: ['tandoor', 'timeout_ms'], coerce: raw => Number(raw) },
    { env: 'MCP_BEARER_TOKEN', path: ['mcp', 'bearer_token'] },
    { env: 'BIND_ADDR', path: ['mcp', 'bind_addr'] },
    { env: 'PERMISSIONS_SAFE_WRITE', path: ['permissions', 'safe_write'], coerce: raw => raw === 'true' },
    { env: 'PERMISSIONS_DESTRUCTIVE', path: ['permissions', 'destructive'], coerce: raw => raw === 'true' }
];

function setPath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
    let node = target;
    for (let i = 0; i < path.length - 1; i += 1) {
        const key = path[i] as string;
        const next = node[key];
        node[key] = typeof next === 'object' && next !== null ? next : {};
        node = node[key] as Record<string, unknown>;
    }
    node[path[path.length - 1] as string] = value;
}

function applyEnvOverrides(raw: Record<string, unknown>): Record<string, unknown> {
    for (const { env, path, coerce } of ENV_OVERRIDES) {
        const value = process.env[env];
        if (value === undefined) continue;
        setPath(raw, path, coerce ? coerce(value) : value);
    }
    return raw;
}

/**
 * Reads config.yaml from configDir if present, applies environment overrides,
 * and validates. Throws ConfigInvalidError — never a bare zod error — so
 * every caller can catch one type and print `.detail`.
 */
export function loadConfig(configDir: string): Config {
    const path = join(configDir, 'config.yaml');
    let raw: Record<string, unknown> = {};
    if (existsSync(path)) {
        const text = readFileSync(path, 'utf8');
        const parsed: unknown = parseYaml(text);
        if (parsed !== null && typeof parsed === 'object') raw = parsed as Record<string, unknown>;
    }

    applyEnvOverrides(raw);

    const result = ConfigSchema.safeParse(raw);
    if (!result.success) {
        const detail = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        throw new ConfigInvalidError(detail);
    }
    return result.data;
}
