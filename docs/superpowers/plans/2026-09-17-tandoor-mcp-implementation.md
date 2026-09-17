# tandoor-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 of tandoor-mcp: a single-instance MCP server for Tandoor Recipes with a 13-tool verb-shaped surface, arr-mcp-style write-safety (permission tiers, confirm handshake, audit trail), an OWASP MCP Top 10 security doc, and OpenAPI-fixture contract testing.

**Architecture:** TypeScript/Node ESM server on `hono` + `@hono/node-server`, one `/mcp` endpoint behind a bearer token, tools registered in-process against a single `TandoorClient`. Core safety primitives (fencing, permissions, confirm tokens, audit log) are ported near-verbatim from `~/git/arr-mcp`, stripped of its multi-service/multi-instance machinery since tandoor-mcp talks to exactly one Tandoor instance.

**Tech Stack:** Node ≥24, TypeScript (strict), zod v4, hono, `@modelcontextprotocol/server` + `@modelcontextprotocol/hono`, better-sqlite3 (audit log), vitest, eslint.

**Spec:** `docs/superpowers/specs/2026-09-17-tandoor-mcp-design.md`

## Global Constraints

- Node ≥24, ESM throughout, source imports use explicit `.ts` extensions (tsconfig `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`), matching arr-mcp's setup.
- zod v4 imported as `import * as z from 'zod/v4'`.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` all on.
- Exactly one Tandoor instance, one MCP bearer token. No adapter registry, no per-instance ids, no `instance` tool parameter anywhere.
- Every mutating Tandoor call goes through `registerWriteTool` (Task 7) — no tool calls a POST/PATCH/DELETE directly.
- Every free-text field Tandoor returns (recipe `description`, step `instruction`, shopping-list `note`, cook-log `comment`) is passed through `fenceText` (Task 3) before it reaches a tool's text or structured output.
- No prompts, no resources, no web config UI — tools only, per the design spec's non-goals.
- MIT license, matching arr-mcp.
- `npm install && npm test` must need no live Tandoor instance and no network access — every test after Task 1 uses an injected fake `fetch`. Only Task 28 (fixture capture) touches a real instance, and only when a maintainer runs it deliberately.

---

## Phase 1 — Foundation

Produces a server that boots, authenticates its bearer token, and answers `/healthz` and an empty `tools/list` — no Tandoor tools registered yet, but every safety primitive tested in isolation.

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`, `LICENSE`, `README.md`
- Create: `src/.gitkeep` (removed once Task 2 adds real files), `test/.gitkeep`

**Interfaces:**
- Produces: `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run dev` scripts every later task relies on.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "tandoor-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "description": "An MCP server for Tandoor Recipes.",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dgibbons/tandoor-mcp.git"
  },
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "node --watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "specs:fetch": "bash scripts/fetch-specs.sh",
    "codegen": "node scripts/codegen.mjs",
    "capture": "node scripts/capture-fixtures.ts"
  },
  "dependencies": {
    "@hono/node-server": "^2.1.1",
    "@modelcontextprotocol/hono": "^2.0.0",
    "@modelcontextprotocol/server": "^2.0.0",
    "better-sqlite3": "^13.0.3",
    "hono": "^4.13.0",
    "pino": "^10.3.1",
    "yaml": "^2.8.1",
    "zod": "^4.6.2"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^24.13.4",
    "eslint": "^10.10.0",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.70.0",
    "vitest": "^5.0.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,

    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,

    "outDir": "dist",
    "rootDir": ".",
    "sourceMap": true,
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["src", "test", "scripts"]
}
```

- [ ] **Step 3: Write tsconfig.build.json**

```json
{
  "extends": "./tsconfig.json",
  "include": ["src"]
}
```

- [ ] **Step 4: Write eslint.config.mjs**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', 'coverage', 'src/generated', 'specs'] },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.mjs', 'vitest.config.ts', 'scripts/codegen.mjs']
                },
                tsconfigRootDir: import.meta.dirname
            }
        }
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: { process: 'readonly', console: 'readonly' }
        }
    }
);
```

- [ ] **Step 5: Write vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 15_000,
        hookTimeout: 15_000
    }
});
```

- [ ] **Step 6: Write .gitignore**

```
node_modules
dist
coverage
specs/*.json
src/generated
config/
*.log
```

- [ ] **Step 7: Write LICENSE**

Copy the MIT license text from `~/git/arr-mcp/LICENSE` verbatim, updating only the copyright name/year line to match this project's owner and 2026.

- [ ] **Step 8: Write a minimal README.md**

```markdown
# tandoor-mcp

An MCP server for [Tandoor Recipes](https://tandoor.dev): recipe search and
authoring, meal planning, shopping lists, and pantry tracking, exposed as a
small set of task-shaped tools rather than one per API endpoint.

See `docs/superpowers/specs/2026-09-17-tandoor-mcp-design.md` for the design
and `docs/security.md` for the threat model.

## Configuration

Copy `config.example.yaml` to your config directory as `config.yaml`, or set
the equivalent environment variables. See that file for every key.

## Running

```bash
npm install
npm run build
TANDOOR_MCP_CONFIG_DIR=./config node dist/src/index.js
```
```

- [ ] **Step 9: Remove the placeholder .gitkeep files once Task 2 adds real files under src/ and test/** (leave them in place for now — this step is a note for Task 2, not an action here).

- [ ] **Step 10: Install and verify**

Run: `npm install`
Expected: installs cleanly, creates `package-lock.json`.

Run: `npm run typecheck`
Expected: passes (nothing under `src/` yet beyond `.gitkeep`, so this only proves the toolchain is wired — if tsc errors because there are zero input files, add an empty `src/index.ts` containing only `export {};` for this step, to be overwritten by Task 8).

- [ ] **Step 11: Commit**

```bash
git add package.json tsconfig.json tsconfig.build.json eslint.config.mjs vitest.config.ts .gitignore LICENSE README.md package-lock.json src test
git commit -m "Scaffold tandoor-mcp project"
```

---

### Task 2: Config schema and loader

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Create: `config.example.yaml`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces:
  - `ConfigSchema: z.ZodType`, `type Config` (fields: `tandoor.url: string`, `tandoor.token: string`, `tandoor.timeout_ms: number`, `mcp.bearer_token: string`, `mcp.bind_addr: string`, `mcp.allowed_hosts: string[]`, `permissions.safe_write: boolean`, `permissions.destructive: boolean`) — `src/config/schema.ts`
  - `class ConfigInvalidError extends Error { readonly detail: string }` — `src/config/load.ts`
  - `function loadConfig(configDir: string): Config` — `src/config/load.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/config.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config/load.ts'`.

- [ ] **Step 3: Write src/config/schema.ts**

```ts
import * as z from 'zod/v4';

export const PermissionsSchema = z
    .object({
        safe_write: z.boolean().default(false),
        destructive: z.boolean().default(false)
    })
    .default({ safe_write: false, destructive: false });
export type Permissions = z.infer<typeof PermissionsSchema>;

const UrlSchema = z.url().refine(u => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'must be an http:// or https:// URL'
});

export const ConfigSchema = z.strictObject({
    tandoor: z.strictObject({
        url: UrlSchema,
        token: z.string().min(1, 'tandoor.token must not be empty'),
        timeout_ms: z.number().int().positive().default(10_000)
    }),
    mcp: z.strictObject({
        bearer_token: z.string().min(32, 'mcp.bearer_token must be at least 32 characters'),
        bind_addr: z.string().default('127.0.0.1:6061'),
        allowed_hosts: z.array(z.string()).default([])
    }),
    permissions: PermissionsSchema
});
export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: Write src/config/load.ts**

```ts
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
        const parsed = parseYaml(text);
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 6: Write config.example.yaml**

```yaml
tandoor:
  # Base URL of your Tandoor instance.
  url: https://recipes.example.com
  # A personal API token generated in Tandoor under Settings -> API,
  # scoped to whatever user you want tandoor-mcp to act as.
  token: your-tandoor-api-token
  # timeout_ms: 10000

mcp:
  # Token clients must send as `Authorization: Bearer <token>` to reach /mcp.
  # Generate one with: openssl rand -hex 32
  bearer_token: replace-with-a-random-32-plus-character-token
  # bind_addr: 127.0.0.1:6061
  # allowed_hosts: []

permissions:
  # Both default to false. A write tool call previews and refuses to apply
  # until you turn the matching tier on here.
  safe_write: false
  destructive: false
```

- [ ] **Step 7: Run the full suite and lint/typecheck**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/config config.example.yaml test/config.test.ts
git commit -m "Add config schema and loader with env overrides"
```

---

### Task 3: Core errors and text fencing

**Files:**
- Create: `src/core/errors.ts`
- Create: `src/core/fence.ts`
- Test: `test/errors.test.ts`
- Test: `test/fence.test.ts`

**Interfaces:**
- Produces:
  - `type ServiceErrorKind = 'Unreachable' | 'AuthFailed' | 'NotFound' | 'RateLimited' | 'Timeout' | 'PermissionDenied' | 'UpstreamError'`
  - `class ServiceError extends Error { readonly kind: ServiceErrorKind; readonly detail: string; readonly remedy: string | undefined }`
  - `function classifyHttpStatus(status: number, url: string): ServiceError | undefined`
  - `function classifyFetchError(err: unknown, url: string): ServiceError`
  - `const FENCE_MAX_LENGTH: number`
  - `function stripDangerous(value: string): string`
  - `function fenceText(value: string, field: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
// test/errors.test.ts
import { describe, expect, it } from 'vitest';
import { ServiceError, classifyFetchError, classifyHttpStatus } from '../src/core/errors.ts';

describe('classifyHttpStatus', () => {
    it('returns undefined for a successful status', () => {
        expect(classifyHttpStatus(200, 'https://t/api/recipe/')).toBeUndefined();
    });

    it('classifies 401 and 403 as AuthFailed with a remedy naming TANDOOR_TOKEN', () => {
        const err = classifyHttpStatus(401, 'https://t/api/recipe/');
        expect(err).toBeInstanceOf(ServiceError);
        expect(err?.kind).toBe('AuthFailed');
        expect(err?.remedy).toMatch(/TANDOOR_TOKEN/);
    });

    it('classifies a numeric-id path 404 as an item lookup failure', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/412/');
        expect(err?.kind).toBe('NotFound');
        expect(err?.remedy).toMatch(/verify it/i);
    });

    it('classifies a non-numeric-id path 404 as a wrong-base-path failure', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/');
        expect(err?.remedy).toMatch(/base path/i);
    });

    it('classifies 429 as RateLimited', () => {
        expect(classifyHttpStatus(429, 'https://t/api/recipe/')?.kind).toBe('RateLimited');
    });

    it('classifies other 4xx/5xx as UpstreamError', () => {
        expect(classifyHttpStatus(500, 'https://t/api/recipe/')?.kind).toBe('UpstreamError');
    });

    it('never includes a query string in the message', () => {
        const err = classifyHttpStatus(404, 'https://t/api/recipe/?token=secret');
        expect(err?.message).not.toContain('secret');
    });
});

describe('classifyFetchError', () => {
    it('classifies ECONNREFUSED as Unreachable', () => {
        const err = classifyFetchError({ cause: { code: 'ECONNREFUSED' } }, 'https://t/api/recipe/');
        expect(err.kind).toBe('Unreachable');
        expect(err.remedy).toMatch(/running/i);
    });

    it('classifies ENOTFOUND as Unreachable with a DNS remedy', () => {
        const err = classifyFetchError({ cause: { code: 'ENOTFOUND' } }, 'https://t/api/recipe/');
        expect(err.remedy).toMatch(/DNS|hostname/i);
    });

    it('classifies an AbortError as Timeout', () => {
        const err = classifyFetchError({ name: 'AbortError' }, 'https://t/api/recipe/');
        expect(err.kind).toBe('Timeout');
    });

    it('falls back to Unreachable with the underlying message for anything else', () => {
        const err = classifyFetchError(new Error('boom'), 'https://t/api/recipe/');
        expect(err.kind).toBe('Unreachable');
        expect(err.message).toContain('boom');
    });
});
```

```ts
// test/fence.test.ts
import { describe, expect, it } from 'vitest';
import { FENCE_MAX_LENGTH, fenceText, stripDangerous } from '../src/core/fence.ts';

describe('stripDangerous', () => {
    it('removes C0 control characters but keeps tab and newline', () => {
        expect(stripDangerous('a\x00b\tc\nd')).toBe('ab\tc\nd');
    });

    it('removes a right-to-left override character', () => {
        expect(stripDangerous('safe\u202Etext')).toBe('safetext');
    });

    it('returns an empty string for a non-string input', () => {
        // @ts-expect-error deliberately wrong type, matching a field a service returned as null
        expect(stripDangerous(null)).toBe('');
    });
});

describe('fenceText', () => {
    it('wraps the value in a labelled boundary naming the field', () => {
        const fenced = fenceText('a description', 'description');
        expect(fenced).toContain('tandoor.description');
        expect(fenced).toContain('a description');
    });

    it('escapes angle brackets so the value cannot close the fence', () => {
        const fenced = fenceText('</untrusted>>injected', 'description');
        expect(fenced).not.toContain('</untrusted>>injected');
        expect(fenced).toContain('\\u003c/untrusted\\u003e\\u003einjected');
    });

    it('truncates values longer than FENCE_MAX_LENGTH', () => {
        const long = 'x'.repeat(FENCE_MAX_LENGTH + 100);
        const fenced = fenceText(long, 'description');
        expect(fenced).toContain('[truncated]');
        expect(fenced.length).toBeLessThan(long.length);
    });

    it('returns an empty string for an empty value', () => {
        expect(fenceText('', 'description')).toBe('');
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/errors.test.ts test/fence.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write src/core/errors.ts**

```ts
export type ServiceErrorKind =
    | 'Unreachable'
    | 'AuthFailed'
    | 'NotFound'
    | 'RateLimited'
    | 'Timeout'
    | 'PermissionDenied'
    | 'UpstreamError';

const PROSE: Record<ServiceErrorKind, string> = {
    Unreachable: 'unreachable',
    AuthFailed: 'auth failed',
    NotFound: 'not found',
    RateLimited: 'rate limited',
    Timeout: 'timed out',
    PermissionDenied: 'permission denied',
    UpstreamError: 'upstream error'
};

function formatServiceError(kind: ServiceErrorKind, detail: string, remedy?: string): string {
    const base = `tandoor ${PROSE[kind]}: ${detail}`;
    return remedy ? `${base} — ${remedy}` : base;
}

/**
 * The one error type every tool throws for a Tandoor-facing failure.
 * `.message` carries the remedy, because the MCP SDK's own dispatch loop
 * builds its error result from `.message` alone.
 */
export class ServiceError extends Error {
    readonly kind: ServiceErrorKind;
    readonly detail: string;
    readonly remedy: string | undefined;

    constructor(kind: ServiceErrorKind, detail: string, opts?: { remedy?: string; cause?: unknown }) {
        super(formatServiceError(kind, detail, opts?.remedy), opts?.cause !== undefined ? { cause: opts.cause } : undefined);
        this.name = 'ServiceError';
        this.kind = kind;
        this.detail = detail;
        this.remedy = opts?.remedy;
    }
}

function safePath(url: string): string {
    try {
        return new URL(url).pathname;
    } catch {
        return url;
    }
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** Tandoor's REST API is uniformly `/api/<resource>/<id>/` — the last
 *  non-empty segment is numeric for an item lookup, anything else for a
 *  collection or malformed base path. */
function classifyNotFoundPath(pathname: string): 'item' | 'collection' {
    const segments = pathname.split('/').filter(Boolean);
    const last = segments.at(-1);
    return last !== undefined && /^\d+$/.test(last) ? 'item' : 'collection';
}

const NOT_FOUND_REMEDY: Record<ReturnType<typeof classifyNotFoundPath>, string> = {
    item: 'This id does not exist in Tandoor — verify it rather than assuming the base URL is wrong.',
    collection: 'Wrong base path — check tandoor.url has no trailing path or reverse-proxy prefix.'
};

export function classifyHttpStatus(status: number, url: string): ServiceError | undefined {
    if (status < 400) return undefined;
    const pathname = safePath(url);
    const at = `HTTP ${status} at ${pathname}`;

    if (status === 401 || status === 403) {
        return new ServiceError('AuthFailed', at, {
            remedy: 'The Tandoor API token is wrong or revoked. Generate a new one in Tandoor under Settings -> API and update TANDOOR_TOKEN.'
        });
    }
    if (status === 404) {
        return new ServiceError('NotFound', at, { remedy: NOT_FOUND_REMEDY[classifyNotFoundPath(pathname)] });
    }
    if (status === 429) {
        return new ServiceError('RateLimited', at, { remedy: 'Tandoor is rate-limiting this endpoint. Wait and retry.' });
    }
    return new ServiceError('UpstreamError', at);
}

const TLS_CODES = new Set([
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID'
]);

export function classifyFetchError(err: unknown, url: string): ServiceError {
    const e = (err ?? {}) as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e.code ?? e.cause?.code;
    const host = safeHost(url);

    if (e.name === 'AbortError' || e.name === 'TimeoutError') {
        return new ServiceError('Timeout', `no response from ${host} within the configured timeout`, { cause: err });
    }
    if (code !== undefined && TLS_CODES.has(code)) {
        return new ServiceError('Unreachable', `TLS error (${code}) at ${host}`, {
            remedy: 'The TLS certificate could not be verified. Use http:// on the LAN, or install a trusted certificate.',
            cause: err
        });
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return new ServiceError('Unreachable', `DNS lookup failed for ${host}`, {
            remedy: 'The hostname does not resolve. Use an IP address, or check your DNS.',
            cause: err
        });
    }
    if (code === 'ECONNREFUSED') {
        return new ServiceError('Unreachable', `connection refused at ${host}`, {
            remedy: 'Nothing is listening on that port. Check Tandoor is running and tandoor.url is right.',
            cause: err
        });
    }
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') {
        return new ServiceError('Unreachable', `could not reach ${host}`, {
            remedy: 'That address is not reachable from this host. Check the URL and network path.',
            cause: err
        });
    }

    const detail = e.cause?.message ?? e.message ?? 'unknown error';
    return new ServiceError('Unreachable', `${detail} at ${host}`, { cause: err });
}
```

- [ ] **Step 4: Write src/core/fence.ts**

```ts
/**
 * Everything Tandoor returns as free text is untrusted data, never
 * instruction. A recipe description or shopping-list note can contain
 * anything its author wrote, including text aimed at whatever reads it next.
 */

export const FENCE_MAX_LENGTH = 2000;

const OPEN = '<<untrusted:';
const CLOSE = '<</untrusted>>';

const DANGEROUS_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x00, 0x08],
    [0x0b, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0xfeff, 0xfeff],
    [0x202a, 0x202e],
    [0x2066, 0x2069]
];

const isDangerous = (codePoint: number): boolean => DANGEROUS_RANGES.some(([low, high]) => codePoint >= low && codePoint <= high);

export function stripDangerous(value: string): string {
    if (typeof value !== 'string') return '';
    let out = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint !== undefined && !isDangerous(codePoint)) out += character;
    }
    return out;
}

/**
 * Wraps free text in a labelled boundary naming the field it came from. The
 * value's own angle brackets are escaped first so it cannot close the fence
 * and continue outside it.
 */
export function fenceText(value: string, field: string): string {
    if (typeof value !== 'string' || value === '') return '';

    let clean = stripDangerous(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
    if (clean.length > FENCE_MAX_LENGTH) {
        clean = `${clean.slice(0, FENCE_MAX_LENGTH)}…[truncated]`;
    }

    return `${OPEN}tandoor.${field}>>${clean}${CLOSE}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/errors.test.ts test/fence.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/errors.ts src/core/fence.ts test/errors.test.ts test/fence.test.ts
git commit -m "Add ServiceError classification and untrusted-text fencing"
```

---

### Task 4: TandoorHttp — the resilient HTTP client

**Files:**
- Create: `src/core/http.ts`
- Test: `test/http.test.ts`

**Interfaces:**
- Consumes: `ServiceError`, `classifyFetchError`, `classifyHttpStatus` from `src/core/errors.ts` (Task 3)
- Produces:
  - `export const CIRCUIT_THRESHOLD = 5`, `export const CIRCUIT_COOLDOWN_MS = 60_000`
  - `class TandoorHttp { constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl?: typeof fetch); get<T>(path: string, opts?: { timeoutMs?: number; retry?: boolean }): Promise<T>; post<T>(path: string, body: unknown): Promise<T>; patch<T>(path: string, body: unknown): Promise<T>; delete(path: string): Promise<void> }`

- [ ] **Step 1: Write the failing tests**

```ts
// test/http.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CIRCUIT_COOLDOWN_MS, CIRCUIT_THRESHOLD, TandoorHttp } from '../src/core/http.ts';
import { ServiceError } from '../src/core/errors.ts';

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('TandoorHttp', () => {
    it('sends the bearer token and prefixes the base URL', async () => {
        const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
            expect(String(url)).toBe('https://t.example/api/recipe/1/');
            expect((init?.headers as Headers).get('authorization')).toBe('Bearer secret');
            return jsonResponse({ id: 1 });
        });
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        const result = await http.get<{ id: number }>('/api/recipe/1/');
        expect(result.id).toBe(1);
    });

    it('classifies a non-2xx response as a ServiceError', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'nope' }, 404));
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.get('/api/recipe/999/')).rejects.toBeInstanceOf(ServiceError);
    });

    it('retries a GET once on timeout, but not a POST', async () => {
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            if (calls === 1) {
                const err = new Error('aborted');
                err.name = 'AbortError';
                throw err;
            }
            return jsonResponse({ ok: true });
        });
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        const result = await http.get<{ ok: boolean }>('/api/recipe/');
        expect(result.ok).toBe(true);
        expect(calls).toBe(2);
    });

    it('does not retry a POST on timeout', async () => {
        let calls = 0;
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            const err = new Error('aborted');
            err.name = 'AbortError';
            throw err;
        });
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.post('/api/recipe/', { name: 'x' })).rejects.toBeInstanceOf(ServiceError);
        expect(calls).toBe(1);
    });

    it('treats DELETE as returning nothing, without parsing a body', async () => {
        const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        await expect(http.delete('/api/meal-plan/1/')).resolves.toBeUndefined();
    });

    it('opens the circuit breaker after CIRCUIT_THRESHOLD consecutive failures, then refuses without calling fetch', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);

        for (let i = 0; i < CIRCUIT_THRESHOLD; i += 1) {
            await expect(http.get('/api/recipe/')).rejects.toBeInstanceOf(ServiceError);
        }
        const callsBeforeOpen = fetchImpl.mock.calls.length;

        const err = await http.get('/api/recipe/').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ServiceError);
        expect((err as ServiceError).message).toMatch(/circuit breaker/);
        expect(fetchImpl.mock.calls.length).toBe(callsBeforeOpen);
    });

    it('does not count a 404 against the circuit breaker', async () => {
        const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
        const http = new TandoorHttp('https://t.example', 'secret', 5000, fetchImpl as unknown as typeof fetch);
        for (let i = 0; i < CIRCUIT_THRESHOLD + 2; i += 1) {
            await expect(http.get('/api/recipe/999/')).rejects.toBeInstanceOf(ServiceError);
        }
        // Still calling fetch every time — a run of 404s never opened the breaker.
        expect(fetchImpl.mock.calls.length).toBe(CIRCUIT_THRESHOLD + 2);
    });
});

// Referenced so the linter does not flag an unused import if a future edit
// trims a case above.
void CIRCUIT_COOLDOWN_MS;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/http.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write src/core/http.ts**

```ts
import { ServiceError, classifyFetchError, classifyHttpStatus } from './errors.ts';

export const CIRCUIT_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 60_000;

type ReadAs = 'json' | 'none';

const discard = async (response: Response): Promise<void> => {
    try {
        await response.body?.cancel();
    } catch {
        // Already consumed or already errored — nothing to release.
    }
};

/**
 * The single HTTP client every Tandoor call goes through: one bearer token,
 * one circuit breaker, one place that decides what a failure means.
 */
export class TandoorHttp {
    readonly #baseUrl: string;
    readonly #basePath: string;
    readonly #token: string;
    readonly #timeoutMs: number;
    readonly #fetch: typeof fetch;

    #consecutiveFailures = 0;
    #openedAt: number | undefined;

    constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl: typeof fetch = fetch) {
        this.#baseUrl = baseUrl;
        this.#basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
        this.#token = token;
        this.#timeoutMs = timeoutMs;
        this.#fetch = fetchImpl;
    }

    async get<T>(path: string, opts?: { timeoutMs?: number; retry?: boolean }): Promise<T> {
        return this.#request<T>('GET', path, undefined, opts?.retry ?? true, opts?.timeoutMs);
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        return this.#request<T>('POST', path, body, false);
    }

    async patch<T>(path: string, body: unknown): Promise<T> {
        return this.#request<T>('PATCH', path, body, false);
    }

    async delete(path: string): Promise<void> {
        await this.#request<unknown>('DELETE', path, undefined, false, undefined, 'none');
    }

    async #request<T>(
        method: string,
        path: string,
        body: unknown,
        retryOnTimeout: boolean,
        timeoutMs?: number,
        read: ReadAs = 'json'
    ): Promise<T> {
        if (this.#circuitOpen()) {
            throw new ServiceError('Unreachable', `circuit breaker is open after ${CIRCUIT_THRESHOLD} consecutive failures`, {
                remedy: `Not retried for ${CIRCUIT_COOLDOWN_MS / 1000}s. Fix Tandoor, then try again.`
            });
        }

        try {
            const result = await this.#attempt<T>(method, path, body, read, timeoutMs);
            this.#recordSuccess();
            return result;
        } catch (err) {
            if (retryOnTimeout && err instanceof ServiceError && err.kind === 'Timeout') {
                try {
                    const result = await this.#attempt<T>(method, path, body, read, timeoutMs);
                    this.#recordSuccess();
                    return result;
                } catch (retryErr) {
                    this.#record(retryErr);
                    throw retryErr;
                }
            }
            this.#record(err);
            throw err;
        }
    }

    #record(err: unknown): void {
        if (err instanceof ServiceError && err.kind === 'NotFound') this.#recordSuccess();
        else this.#recordFailure();
    }

    async #attempt<T>(method: string, path: string, body: unknown, read: ReadAs, timeoutMs?: number): Promise<T> {
        const url = new URL(this.#basePath + path, this.#baseUrl);
        const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${this.#token}` });
        if (body !== undefined) headers.set('content-type', 'application/json');

        const safeUrl = `${new URL(this.#baseUrl).origin}${url.pathname}`;

        let response: Response;
        try {
            response = await this.#fetch(url.toString(), {
                method,
                headers,
                signal: AbortSignal.timeout(timeoutMs ?? this.#timeoutMs),
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            });
        } catch (err) {
            throw classifyFetchError(err, safeUrl);
        }

        const httpError = classifyHttpStatus(response.status, safeUrl);
        if (httpError) {
            await discard(response);
            throw httpError;
        }

        if (read === 'none') {
            await discard(response);
            return undefined as T;
        }

        try {
            return (await response.json()) as T;
        } catch (err) {
            throw new ServiceError('UpstreamError', `response from ${url.pathname} was not valid JSON`, { cause: err });
        }
    }

    #circuitOpen(): boolean {
        if (this.#openedAt === undefined) return false;
        if (Date.now() - this.#openedAt >= CIRCUIT_COOLDOWN_MS) {
            this.#openedAt = undefined;
            this.#consecutiveFailures = CIRCUIT_THRESHOLD - 1;
            return false;
        }
        return true;
    }

    #recordSuccess(): void {
        this.#consecutiveFailures = 0;
        this.#openedAt = undefined;
    }

    #recordFailure(): void {
        this.#consecutiveFailures += 1;
        if (this.#consecutiveFailures >= CIRCUIT_THRESHOLD && this.#openedAt === undefined) {
            this.#openedAt = Date.now();
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/http.test.ts`
Expected: PASS, all seven cases.

- [ ] **Step 5: Commit**

```bash
git add src/core/http.ts test/http.test.ts
git commit -m "Add TandoorHttp: bearer auth, retry-once-on-timeout, circuit breaker"
```

---

### Task 5: Confirm tokens, permissions, audit log

**Files:**
- Create: `src/core/confirm.ts`
- Create: `src/core/permissions.ts`
- Create: `src/core/audit.ts`
- Test: `test/confirm.test.ts`
- Test: `test/permissions.test.ts`
- Test: `test/audit.test.ts`

**Interfaces:**
- Consumes: `Permissions` type from `src/config/schema.ts` (Task 2)
- Produces:
  - `type WriteTier = 'safe' | 'destructive'`, `const WRITE_TIERS`
  - `type WriteIntent = { tool: string; tier: WriteTier; operation: string; target: string; args?: Record<string, unknown> }`
  - `type ConfirmResult = { ok: true } | { ok: false; failure: 'expired' | 'mismatch' | 'used' | 'malformed'; remedy: string }`
  - `class ConfirmTokens { constructor(opts?: { clock?: () => number; ttlMs?: number; key?: Buffer }); issue(intent: WriteIntent): string; verifyAndConsume(presented: string, intent: WriteIntent): ConfirmResult }`
  - `type PermissionVerdict = { allowed: true; tier: WriteTier } | { allowed: false; tier: WriteTier; reason: string; remedy: string }`
  - `function checkPermission(permissions: Permissions, tier: WriteTier): PermissionVerdict`
  - `type WriteOutcome = 'attempted' | 'applied' | 'dry_run' | 'denied' | 'unconfirmed' | 'failed'`
  - `type AuditRecord = { tool: string; operation: string; tier: WriteTier; target: string; args: Record<string, unknown> }`
  - `class WriteAudit { static open(configDir: string): WriteAudit; static ephemeral(): WriteAudit; begin(record: AuditRecord): number; settle(id: number, outcome: Exclude<WriteOutcome, 'attempted'>, detail?: string): void; recent(limit?: number): AuditRow[]; close(): void }`

- [ ] **Step 1: Write the failing tests**

```ts
// test/confirm.test.ts
import { describe, expect, it } from 'vitest';
import { ConfirmTokens, type WriteIntent } from '../src/core/confirm.ts';

const intent = (overrides: Partial<WriteIntent> = {}): WriteIntent => ({
    tool: 'delete_meal_plan',
    tier: 'destructive',
    operation: 'delete_meal_plan',
    target: '5',
    ...overrides
});

describe('ConfirmTokens', () => {
    it('issues a token that verifies and consumes for the same intent', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        expect(tokens.verifyAndConsume(token, intent())).toEqual({ ok: true });
    });

    it('rejects a token used twice', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        tokens.verifyAndConsume(token, intent());
        const second = tokens.verifyAndConsume(token, intent());
        expect(second).toMatchObject({ ok: false, failure: 'used' });
    });

    it('rejects a token issued for a different target', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent({ target: '5' }));
        const result = tokens.verifyAndConsume(token, intent({ target: '9' }));
        expect(result).toMatchObject({ ok: false, failure: 'mismatch' });
    });

    it('rejects an expired token', () => {
        let now = 0;
        const tokens = new ConfirmTokens({ clock: () => now, ttlMs: 1000 });
        const token = tokens.issue(intent());
        now = 2000;
        expect(tokens.verifyAndConsume(token, intent())).toMatchObject({ ok: false, failure: 'expired' });
    });

    it('rejects a malformed token', () => {
        const tokens = new ConfirmTokens();
        expect(tokens.verifyAndConsume('not-a-real-token', intent())).toMatchObject({ ok: false, failure: 'malformed' });
    });

    it('tolerates surrounding backticks and trailing punctuation', () => {
        const tokens = new ConfirmTokens();
        const token = tokens.issue(intent());
        expect(tokens.verifyAndConsume(`\`${token}\`.`, intent())).toEqual({ ok: true });
    });
});
```

```ts
// test/permissions.test.ts
import { describe, expect, it } from 'vitest';
import { checkPermission } from '../src/core/permissions.ts';

describe('checkPermission', () => {
    it('denies a safe write when both tiers are off', () => {
        const verdict = checkPermission({ safe_write: false, destructive: false }, 'safe');
        expect(verdict.allowed).toBe(false);
    });

    it('allows a safe write when safe_write is on', () => {
        expect(checkPermission({ safe_write: true, destructive: false }, 'safe').allowed).toBe(true);
    });

    it('allows a safe write when only destructive is on — destructive implies safe', () => {
        expect(checkPermission({ safe_write: false, destructive: true }, 'safe').allowed).toBe(true);
    });

    it('denies a destructive write when only safe_write is on', () => {
        expect(checkPermission({ safe_write: true, destructive: false }, 'destructive').allowed).toBe(false);
    });

    it('allows a destructive write when destructive is on', () => {
        expect(checkPermission({ safe_write: false, destructive: true }, 'destructive').allowed).toBe(true);
    });

    it('names the config key to change in a denial remedy', () => {
        const verdict = checkPermission({ safe_write: false, destructive: false }, 'destructive');
        expect(verdict.allowed).toBe(false);
        if (!verdict.allowed) expect(verdict.remedy).toMatch(/permissions\.destructive/);
    });
});
```

```ts
// test/audit.test.ts
import { describe, expect, it } from 'vitest';
import { WriteAudit } from '../src/core/audit.ts';

const record = () => ({ tool: 'delete_meal_plan', operation: 'delete_meal_plan', tier: 'destructive' as const, target: '5', args: {} });

describe('WriteAudit', () => {
    it('writes an attempted row on begin and reads it back via recent()', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin(record());
        const [row] = audit.recent(1);
        expect(row?.id).toBe(id);
        expect(row?.outcome).toBe('attempted');
        audit.close();
    });

    it('settle() replaces the outcome in place rather than adding a row', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin(record());
        audit.settle(id, 'applied');
        expect(audit.recent(10)).toHaveLength(1);
        expect(audit.recent(1)[0]?.outcome).toBe('applied');
        audit.close();
    });

    it('redacts a key that looks like a secret, recursively', () => {
        const audit = WriteAudit.ephemeral();
        const id = audit.begin({ ...record(), args: { note: 'fine', nested: { api_key: 'shhh' } } });
        const row = audit.recent(1)[0];
        expect(row?.args).not.toContain('shhh');
        expect(row?.args).toContain('__REDACTED__');
        void id;
        audit.close();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/confirm.test.ts test/permissions.test.ts test/audit.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write src/core/confirm.ts**

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type WriteTier = 'safe' | 'destructive';

export const CONFIRM_TTL_MS = 300_000;
const MAX_CONSUMED = 10_000;

export type WriteIntent = {
    tool: string;
    tier: WriteTier;
    operation: string;
    target: string;
    args?: Record<string, unknown>;
};

export type ConfirmFailure = 'expired' | 'mismatch' | 'used' | 'malformed';
export type ConfirmResult = { ok: true } | { ok: false; failure: ConfirmFailure; remedy: string };

const REMEDY: Record<ConfirmFailure, string> = {
    expired: `The confirmation token has expired (they last ${CONFIRM_TTL_MS / 1000}s). Call this tool again without \`confirm\` for a fresh token.`,
    mismatch:
        'That confirmation token was issued for a different operation or arguments. Call this tool again without `confirm` to preview *this* operation and use the token it returns.',
    used: 'That confirmation token has already been used. Call this tool again without `confirm` if you genuinely intend to repeat the operation.',
    malformed: 'That is not a confirmation token issued by this server. Call this tool again without `confirm` to get one.'
};

function canonicalize(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

const intentPayload = (intent: WriteIntent): string =>
    canonicalize({ tool: intent.tool, tier: intent.tier, operation: intent.operation, target: intent.target, args: intent.args ?? {} });

function unwrap(presented: string): string {
    let out = presented.trim();
    for (let previous = ''; out !== previous; ) {
        previous = out;
        out = out
            .replace(/^[`'"]+/u, '')
            .replace(/[`'"]+$/u, '')
            .replace(/[.,;:!?]+$/u, '')
            .trim();
    }
    return out;
}

function signatureMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        timingSafeEqual(b, b);
        return false;
    }
    return timingSafeEqual(a, b);
}

/** Per-call write confirmation: single-use, HMAC-bound to the exact
 *  operation, five-minute TTL. See docs/security.md MCP06. */
export class ConfirmTokens {
    readonly #key: Buffer;
    readonly #now: () => number;
    readonly #ttlMs: number;
    readonly #consumed = new Map<string, number>();

    constructor(opts: { clock?: () => number; ttlMs?: number; key?: Buffer } = {}) {
        this.#key = opts.key ?? randomBytes(32);
        this.#now = opts.clock ?? Date.now;
        this.#ttlMs = opts.ttlMs ?? CONFIRM_TTL_MS;
    }

    issue(intent: WriteIntent): string {
        const issuedAt = this.#now();
        return `v1.${issuedAt.toString(36)}.${this.#sign(intent, issuedAt)}`;
    }

    verifyAndConsume(presented: string, intent: WriteIntent): ConfirmResult {
        this.#sweep();

        const parts = unwrap(presented).split('.');
        if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, failure: 'malformed', remedy: REMEDY.malformed };

        const issuedAt = Number.parseInt(parts[1] ?? '', 36);
        const signature = parts[2] ?? '';
        if (!Number.isFinite(issuedAt) || signature === '') return { ok: false, failure: 'malformed', remedy: REMEDY.malformed };

        const age = this.#now() - issuedAt;
        if (age < 0 || age > this.#ttlMs) return { ok: false, failure: 'expired', remedy: REMEDY.expired };

        if (!signatureMatches(signature, this.#sign(intent, issuedAt))) {
            return { ok: false, failure: 'mismatch', remedy: REMEDY.mismatch };
        }

        if (this.#consumed.has(signature)) return { ok: false, failure: 'used', remedy: REMEDY.used };

        this.#consumed.set(signature, issuedAt + this.#ttlMs);
        return { ok: true };
    }

    #sign(intent: WriteIntent, issuedAt: number): string {
        return createHmac('sha256', this.#key).update(`${issuedAt}\n${intentPayload(intent)}`).digest('base64url');
    }

    #sweep(): void {
        const now = this.#now();
        for (const [signature, deadAt] of this.#consumed) {
            if (deadAt <= now) this.#consumed.delete(signature);
        }
        while (this.#consumed.size > MAX_CONSUMED) {
            const oldest = this.#consumed.keys().next().value;
            if (oldest === undefined) break;
            this.#consumed.delete(oldest);
        }
    }
}
```

- [ ] **Step 4: Write src/core/permissions.ts**

```ts
import type { Permissions } from '../config/schema.ts';

export const WRITE_TIERS = ['safe', 'destructive'] as const;
export type WriteTier = (typeof WRITE_TIERS)[number];

const TIER_KEY: Record<WriteTier, string> = { safe: 'safe_write', destructive: 'destructive' };

export type PermissionVerdict =
    | { allowed: true; tier: WriteTier }
    | { allowed: false; tier: WriteTier; reason: string; remedy: string };

/**
 * Ordered tiers: `destructive: true` grants `safe` writes too, because a
 * config permitting deletion but refusing a safe re-add describes no policy
 * anyone would choose on purpose. Both default false.
 */
export function checkPermission(permissions: Permissions, tier: WriteTier): PermissionVerdict {
    const granted = tier === 'safe' ? permissions.safe_write || permissions.destructive : permissions.destructive;
    if (granted) return { allowed: true, tier };

    const key = TIER_KEY[tier];
    const envVar = tier === 'safe' ? 'PERMISSIONS_SAFE_WRITE' : 'PERMISSIONS_DESTRUCTIVE';
    return {
        allowed: false,
        tier,
        reason: `${tier} writes are disabled`,
        remedy: `Set \`permissions.${key}: true\` in config.yaml (or ${envVar}=true) and restart tandoor-mcp. This is off by default.`
    };
}
```

- [ ] **Step 5: Write src/core/audit.ts**

```ts
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { join } from 'node:path';
import type { WriteTier } from './permissions.ts';

export const AUDIT_FILENAME = 'audit.db';

export type WriteOutcome = 'attempted' | 'applied' | 'dry_run' | 'denied' | 'unconfirmed' | 'failed';

export type AuditRecord = {
    tool: string;
    operation: string;
    tier: WriteTier;
    target: string;
    args: Record<string, unknown>;
};

export type AuditRow = {
    id: number;
    at: string;
    tool: string;
    operation: string;
    tier: string;
    target: string;
    args: string;
    outcome: string;
    detail: string | null;
    settled_at: string | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS write_audit (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT    NOT NULL,
    tool      TEXT    NOT NULL,
    operation TEXT    NOT NULL,
    tier      TEXT    NOT NULL,
    target    TEXT    NOT NULL,
    args      TEXT    NOT NULL,
    outcome   TEXT    NOT NULL,
    detail    TEXT,
    settled_at TEXT
);
CREATE INDEX IF NOT EXISTS write_audit_at ON write_audit (at DESC);
`;

const SECRET_KEY = /(api[_-]?key|token|password|secret|authorization)/i;

const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) ? '__REDACTED__' : scrub(v)]));
    }
    return value;
};

function safeArgs(args: Record<string, unknown>): string {
    return JSON.stringify(scrub(args));
}

export class AuditUnavailableError extends Error {
    constructor(path: string, cause: unknown) {
        super(
            `the write audit log at ${path} could not be opened, so writes are refused — check the config volume is writable and not full. (${(cause as Error)?.message ?? 'unknown error'})`,
            { cause }
        );
        this.name = 'AuditUnavailableError';
    }
}

/** The write audit: every write attempt, including previews and refusals,
 *  as a durable row. See docs/security.md MCP08. */
export class WriteAudit {
    readonly #db: Db;
    readonly #path: string;

    private constructor(db: Db, path: string) {
        this.#db = db;
        this.#path = path;
    }

    static open(configDir: string): WriteAudit {
        const path = join(configDir, AUDIT_FILENAME);
        try {
            const db = new Database(path);
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = FULL');
            db.exec(SCHEMA);
            return new WriteAudit(db, path);
        } catch (err) {
            throw new AuditUnavailableError(path, err);
        }
    }

    static ephemeral(): WriteAudit {
        const db = new Database(':memory:');
        db.exec(SCHEMA);
        return new WriteAudit(db, ':memory:');
    }

    begin(record: AuditRecord): number {
        try {
            const result = this.#db
                .prepare(`INSERT INTO write_audit (at, tool, operation, tier, target, args, outcome) VALUES (?, ?, ?, ?, ?, ?, 'attempted')`)
                .run(new Date().toISOString(), record.tool, record.operation, record.tier, record.target, safeArgs(record.args));
            return Number(result.lastInsertRowid);
        } catch (err) {
            throw new AuditUnavailableError(this.#path, err);
        }
    }

    settle(id: number, outcome: Exclude<WriteOutcome, 'attempted'>, detail?: string): void {
        this.#db.prepare(`UPDATE write_audit SET outcome = ?, detail = ?, settled_at = ? WHERE id = ?`).run(outcome, detail ?? null, new Date().toISOString(), id);
    }

    recent(limit = 50): AuditRow[] {
        return this.#db.prepare(`SELECT * FROM write_audit ORDER BY id DESC LIMIT ?`).all(limit) as AuditRow[];
    }

    close(): void {
        this.#db.close();
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/confirm.test.ts test/permissions.test.ts test/audit.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/confirm.ts src/core/permissions.ts src/core/audit.ts test/confirm.test.ts test/permissions.test.ts test/audit.test.ts
git commit -m "Add confirm handshake, permission tiers, and write audit log"
```

---

### Task 6: Tool-shape helpers

**Files:**
- Create: `src/core/shape.ts`
- Test: `test/shape.test.ts`

**Interfaces:**
- Produces:
  - `const DEFAULT_LIMIT = 50`, `const MAX_LIMIT = 500`
  - `const LimitSchema: z.ZodType<number>`, `const OffsetSchema: z.ZodType<number>`
  - `const READ_ONLY = { readOnlyHint: true } as const`
  - `function toolInput<T extends z.ZodRawShape>(shape: T): z.ZodObject`
  - `const TruncationSchema: z.ZodType`
  - `function applyLimit<T>(items: readonly T[], limit: number, offset?: number): { items: T[]; total: number; returned: number; offset: number; truncated: boolean }`
  - `function listText<T>(summary: string, items: readonly T[], line: (item: T) => string): string`

- [ ] **Step 1: Write the failing test**

```ts
// test/shape.test.ts
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { LimitSchema, OffsetSchema, applyLimit, listText, toolInput } from '../src/core/shape.ts';

describe('applyLimit', () => {
    it('windows items and reports total/returned/truncated', () => {
        const result = applyLimit([1, 2, 3, 4, 5], 2);
        expect(result).toEqual({ items: [1, 2], total: 5, returned: 2, offset: 0, truncated: true });
    });

    it('reports truncated: false when the window covers everything', () => {
        const result = applyLimit([1, 2], 50);
        expect(result.truncated).toBe(false);
    });

    it('starts at 0 for a negative offset rather than counting from the end', () => {
        expect(applyLimit([1, 2, 3], 10, -5).items).toEqual([1, 2, 3]);
    });

    it('clamps limit to at least 1', () => {
        expect(applyLimit([1, 2, 3], 0).items).toEqual([1]);
    });
});

describe('listText', () => {
    it('joins the summary and one line per item', () => {
        const text = listText('2 recipes', [{ name: 'A' }, { name: 'B' }], i => i.name);
        expect(text).toBe('2 recipes\nA\nB');
    });

    it('falls back to just the summary when there are no items', () => {
        expect(listText('0 recipes', [], () => 'x')).toBe('0 recipes');
    });

    it('collapses embedded newlines in a single item to one line', () => {
        const text = listText('1 item', ['a\nb'], i => i);
        expect(text).toBe('1 item\na b');
    });
});

describe('toolInput', () => {
    it('produces a strict object that refuses unknown keys with a listing message', () => {
        const schema = toolInput({ name: z.string() });
        const result = schema.safeParse({ name: 'x', bogus: 1 });
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error?.issues)).toMatch(/Unknown argument/);
        expect(JSON.stringify(result.error?.issues)).toMatch(/name/);
    });
});

describe('LimitSchema / OffsetSchema', () => {
    it('defaults limit to 50 and offset to 0', () => {
        expect(LimitSchema.parse(undefined)).toBe(50);
        expect(OffsetSchema.parse(undefined)).toBe(0);
    });

    it('rejects a limit above 500', () => {
        expect(LimitSchema.safeParse(501).success).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/shape.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write src/core/shape.ts**

```ts
import * as z from 'zod/v4';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const LimitSchema = z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe(`Maximum items to return. Defaults to ${DEFAULT_LIMIT}, hard maximum ${MAX_LIMIT}.`);

export const OffsetSchema = z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('How many items to skip before the window `limit` returns. `total` always counts the whole list, so `offset + returned < total` means there is another page.');

export const READ_ONLY = { readOnlyHint: true } as const;

/** Every tool's arguments, refusing ones it does not have rather than
 *  silently dropping them. */
export function toolInput<T extends z.ZodRawShape>(shape: T) {
    const accepted = Object.keys(shape).sort().join(', ');
    return z.strictObject(shape, {
        error: issue =>
            issue.code === 'unrecognized_keys'
                ? `Unknown argument(s): ${issue.keys.join(', ')}. This tool accepts: ${accepted}.`
                : undefined
    });
}

export const TruncationSchema = z.looseObject({
    items: z.array(z.unknown()).describe('The window of results.'),
    total: z.number().int().describe('How many matched in total — the whole list, never the window.'),
    returned: z.number().int().describe('How many are in `items`.'),
    offset: z.number().int().describe('How many were skipped.'),
    truncated: z.boolean().describe('True when this is not the whole list.')
});

export function applyLimit<T>(items: readonly T[], limit: number, offset = 0): { items: T[]; total: number; returned: number; offset: number; truncated: boolean } {
    const effective = Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
    const start = Math.max(Math.trunc(offset), 0);
    const sliced = items.slice(start, start + effective);
    return { items: sliced, total: items.length, returned: sliced.length, offset: start, truncated: sliced.length < items.length };
}

export function listText<T>(summary: string, items: readonly T[], line: (item: T) => string): string {
    const lines = items.map(item => line(item).replaceAll(/[\r\n]+/gu, ' ')).filter(text => text !== '');
    return lines.length === 0 ? summary : `${summary}\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/shape.ts test/shape.test.ts
git commit -m "Add tool-shape helpers: strict input, paging, list text"
```

---

### Task 7: Write-tool harness

**Files:**
- Create: `src/tools/write.ts`
- Test: `test/write.test.ts`

**Interfaces:**
- Consumes: `checkPermission`, `WriteTier` from `src/core/permissions.ts` (Task 5); `ConfirmTokens`, `WriteIntent` from `src/core/confirm.ts` (Task 5); `WriteAudit` from `src/core/audit.ts` (Task 5); `ServiceError` from `src/core/errors.ts` (Task 3); `toolInput` from `src/core/shape.ts` (Task 6); `Permissions` from `src/config/schema.ts` (Task 2)
- Produces:
  - `type WritePlan = { target: string; summary: string; effects: string[]; args?: Record<string, unknown>; noop?: boolean }`
  - `type WriteToolSpec<Schema extends z.ZodObject> = { name: string; title: string; description: string; inputSchema: Schema; operation: string; tier: WriteTier; plan(args): Promise<WritePlan>; apply(plan, args): Promise<unknown>; applied?(outcome, plan): string | undefined }`
  - `type WriteContext = { permissions: Permissions; confirm: ConfirmTokens; audit: WriteAudit }`
  - `function registerWriteTool<Schema extends z.ZodObject>(server: McpServer, context: WriteContext, spec: WriteToolSpec<Schema>): void`

This is the one place a write tool becomes an MCP tool: permission tier, `dry_run`, the audit record, and per-call confirmation are handled once here, so each write tool below supplies only `plan`/`apply`.

- [ ] **Step 1: Write the failing test**

```ts
// test/write.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from '../src/tools/write.ts';

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
        async plan({ id }): Promise<WritePlan> {
            return { target: String(id), summary: `Delete thing ${id}.`, effects: ['Cannot be undone.'], args: { id } };
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
        registerTestTool(server, buildContext({ destructive: true }), async id => {
            applied = true;
            return { deleted: id };
        });
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'delete_thing', arguments: { id: 5 } } },
            z.any()
        )) as { structuredContent: { applied: boolean; confirm_token?: string } };
        expect(applied).toBe(false);
        expect(result.structuredContent.applied).toBe(false);
        expect(result.structuredContent.confirm_token).toBeDefined();
    });

    it('applies once a valid confirm token is presented', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        let applied = false;
        registerTestTool(server, buildContext({ destructive: true }), async id => {
            applied = true;
            return { deleted: id };
        });
        const preview = (await server.server.request(
            { method: 'tools/call', params: { name: 'delete_thing', arguments: { id: 5 } } },
            z.any()
        )) as { structuredContent: { confirm_token: string } };

        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'delete_thing', arguments: { id: 5, confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean } };
        expect(applied).toBe(true);
        expect(result.structuredContent.applied).toBe(true);
    });

    it('refuses to apply when the permission tier is off, even with a confirm token from elsewhere', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerTestTool(server, buildContext({ destructive: false }), async () => ({}));
        await expect(
            server.server.request({ method: 'tools/call', params: { name: 'delete_thing', arguments: { id: 5 } } }, z.any())
        ).rejects.toThrow(/permission denied/i);
    });

    it('a dry_run never mutates and never issues a confirm token', async () => {
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        let applied = false;
        registerTestTool(server, buildContext({ destructive: true }), async id => {
            applied = true;
            return { deleted: id };
        });
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'delete_thing', arguments: { id: 5, dry_run: true } } },
            z.any()
        )) as { structuredContent: { confirm_token?: string } };
        expect(applied).toBe(false);
        expect(result.structuredContent.confirm_token).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/write.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write src/tools/write.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Permissions } from '../config/schema.ts';
import type { WriteAudit } from '../core/audit.ts';
import type { ConfirmTokens, WriteIntent } from '../core/confirm.ts';
import { ServiceError } from '../core/errors.ts';
import { checkPermission, type WriteTier } from '../core/permissions.ts';
import { toolInput } from '../core/shape.ts';

export type WritePlan = {
    target: string;
    summary: string;
    effects: string[];
    args?: Record<string, unknown>;
    noop?: boolean;
};

export type WriteToolSpec<Schema extends z.ZodObject> = {
    name: string;
    title: string;
    description: string;
    inputSchema: Schema;
    operation: string;
    tier: WriteTier;
    plan(args: z.infer<Schema>): Promise<WritePlan>;
    apply(plan: WritePlan, args: z.infer<Schema>): Promise<unknown>;
    applied?(outcome: unknown, plan: WritePlan): string | undefined;
};

export type WriteContext = {
    permissions: Permissions;
    confirm: ConfirmTokens;
    audit: WriteAudit;
};

const DryRunSchema = z
    .boolean()
    .default(false)
    .describe('Preview only: resolve the target and describe what would happen, then stop. Never mutates and never returns a confirmation token.');

const ConfirmSchema = z
    .string()
    .optional()
    .describe("The confirmation token from this same tool's preview of this same operation. Omit it to get a preview and a token; pass the token back verbatim to apply the change.");

const WriteOutputSchema = z.looseObject({
    applied: z.boolean(),
    dry_run: z.boolean(),
    tool: z.string(),
    operation: z.string(),
    tier: z.enum(['safe', 'destructive']),
    target: z.string(),
    summary: z.string(),
    effects: z.array(z.string()),
    noop: z.boolean(),
    permission: z.looseObject({ allowed: z.boolean(), reason: z.string().optional(), remedy: z.string().optional() }),
    confirm_token: z.string().optional(),
    confirm_error: z.string().optional(),
    result: z.unknown().optional(),
    audit_id: z.number().optional()
});

export type WriteToolResult = {
    applied: boolean;
    dry_run: boolean;
    tool: string;
    operation: string;
    tier: WriteTier;
    target: string;
    summary: string;
    effects: string[];
    noop: boolean;
    permission: { allowed: boolean; reason?: string; remedy?: string };
    confirm_token?: string;
    confirm_error?: string;
    result?: unknown;
    audit_id?: number;
};

/**
 * Turns a plan/apply pair into an MCP tool with permission tier, dry_run, the
 * audit record, and per-call confirmation handled once. A tool physically
 * cannot mutate during preview, because preview only calls `plan`.
 */
export function registerWriteTool<Schema extends z.ZodObject>(server: McpServer, context: WriteContext, spec: WriteToolSpec<Schema>): void {
    const { permissions, confirm, audit } = context;

    server.registerTool(
        spec.name,
        {
            title: spec.title,
            annotations: { readOnlyHint: false, destructiveHint: spec.tier === 'destructive' },
            description: spec.description,
            inputSchema: toolInput({ ...spec.inputSchema.shape, dry_run: DryRunSchema, confirm: ConfirmSchema }),
            outputSchema: WriteOutputSchema
        },
        async (raw: Record<string, unknown>) => {
            const { dry_run: dryRun, confirm: presented, ...rest } = raw as { dry_run: boolean; confirm?: string };
            const args = rest as z.infer<Schema>;

            const plan = await spec.plan(args);
            const verdict = checkPermission(permissions, spec.tier);
            const permission: WriteToolResult['permission'] = verdict.allowed
                ? { allowed: true }
                : { allowed: false, reason: verdict.reason, remedy: verdict.remedy };

            const record = { tool: spec.name, operation: spec.operation, tier: spec.tier, target: plan.target, args: plan.args ?? {} };

            const preview = (extra: Partial<WriteToolResult>): WriteToolResult => ({
                applied: false,
                dry_run: dryRun,
                tool: spec.name,
                operation: spec.operation,
                tier: spec.tier,
                target: plan.target,
                summary: plan.summary,
                effects: plan.effects,
                noop: plan.noop === true,
                permission,
                ...extra
            });

            const respond = (result: WriteToolResult, text: string) => ({
                content: [{ type: 'text' as const, text }],
                structuredContent: result
            });

            if (plan.noop === true) {
                const id = audit.begin(record);
                audit.settle(id, 'dry_run', 'no-op: already in the requested state');
                return respond(preview({ audit_id: id }), `Nothing to do — ${plan.summary} No change was made and no confirmation is needed.`);
            }

            if (dryRun) {
                const id = audit.begin(record);
                audit.settle(id, 'dry_run', verdict.allowed ? undefined : verdict.reason);
                return respond(
                    preview({ audit_id: id }),
                    `Dry run — nothing was changed. ${plan.summary}` +
                        (verdict.allowed ? ' Omit `dry_run` to preview it for real and receive a confirmation token.' : ` Note that this write would currently be refused: ${verdict.reason}. ${verdict.remedy}`)
                );
            }

            if (!verdict.allowed) {
                const id = audit.begin(record);
                audit.settle(id, 'denied', verdict.reason);
                throw new ServiceError('PermissionDenied', verdict.reason, { remedy: verdict.remedy });
            }

            const intent: WriteIntent = {
                tool: spec.name,
                tier: spec.tier,
                operation: spec.operation,
                target: plan.target,
                ...(plan.args === undefined ? {} : { args: plan.args })
            };

            if (presented !== undefined) {
                const check = confirm.verifyAndConsume(presented, intent);
                if (!check.ok) {
                    if (check.failure === 'used') {
                        const id = audit.begin(record);
                        audit.settle(id, 'denied', 'confirmation token already used');
                        throw new ServiceError('PermissionDenied', 'confirmation token already used', { remedy: check.remedy });
                    }
                    const id = audit.begin(record);
                    audit.settle(id, 'unconfirmed', `confirmation ${check.failure}`);
                    const fresh = confirm.issue(intent);
                    return respond(
                        preview({ audit_id: id, confirm_error: check.remedy, confirm_token: fresh }),
                        `Not applied — the confirmation token was rejected (${check.failure}). Do not resend the rejected one. To apply this, call ${spec.name} again with the same arguments plus \`confirm\` set to \`${fresh}\`.`
                    );
                }
            } else {
                const id = audit.begin(record);
                audit.settle(id, 'unconfirmed');
                const token = confirm.issue(intent);
                return respond(
                    preview({ audit_id: id, confirm_token: token }),
                    `Not applied yet. ${plan.summary}\n\n${plan.effects.map(e => `- ${e}`).join('\n')}\n\nTo apply this, call ${spec.name} again with the same arguments plus \`confirm\` set to \`${token}\`.`
                );
            }

            const id = audit.begin(record);
            let outcome: unknown;
            try {
                outcome = await spec.apply(plan, args);
            } catch (err) {
                audit.settle(id, 'failed', err instanceof Error ? err.message : String(err));
                throw err;
            }

            audit.settle(id, 'applied');
            return respond(
                { ...preview({ audit_id: id }), applied: true, ...(outcome === undefined ? {} : { result: outcome }) },
                spec.applied?.(outcome, plan) ?? `Applied. ${plan.summary}`
            );
        }
    );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/write.test.ts`
Expected: PASS, all four cases. If the `@modelcontextprotocol/server` `McpServer.server.request` call shape differs from what's assumed here, adjust the test to whatever that package's actual low-level request API is (check its type definitions under `node_modules/@modelcontextprotocol/server`) — the behavior under test (preview/confirm/permission/dry_run) is what matters, not the exact invocation shape.

- [ ] **Step 5: Commit**

```bash
git add src/tools/write.ts test/write.test.ts
git commit -m "Add registerWriteTool: the shared plan/confirm/apply harness"
```

---

### Task 8: HTTP app, bearer auth, healthz, entrypoint

**Files:**
- Create: `src/mcp/endpointAuth.ts`
- Create: `src/app.ts`
- Create: `src/bootstrap.ts`
- Create: `src/index.ts`
- Create: `src/core/logger.ts`
- Test: `test/endpointAuth.test.ts`
- Test: `test/app.test.ts`

**Interfaces:**
- Consumes: `Config` from `src/config/schema.ts`, `loadConfig`/`ConfigInvalidError` from `src/config/load.ts` (Task 2), `WriteAudit` from `src/core/audit.ts` (Task 5)
- Produces:
  - `function tokenMatches(presented: string, expected: string): boolean`, `function bearerFromHeader(header: string | undefined): string | undefined` — `src/mcp/endpointAuth.ts`
  - `const MAX_BODY_BYTES: number`, `function buildApp(opts: { config: Config; buildServer: () => McpServer }): Hono` — `src/app.ts`
  - `function bootstrap(configDir: string): Promise<{ app: Hono; audit: WriteAudit }>` — `src/bootstrap.ts` (throws `ConfigInvalidError` on bad config; caller decides what to do)
  - `const logger` (pino instance) — `src/core/logger.ts`

This task produces the first end-to-end milestone: the server boots, serves `/healthz`, and requires a valid bearer token on `/mcp` — with zero Tandoor tools registered yet (Phase 2 adds those).

- [ ] **Step 1: Write the failing tests**

```ts
// test/endpointAuth.test.ts
import { describe, expect, it } from 'vitest';
import { bearerFromHeader, tokenMatches } from '../src/mcp/endpointAuth.ts';

describe('bearerFromHeader', () => {
    it('extracts the token from a Bearer header', () => {
        expect(bearerFromHeader('Bearer abc123')).toBe('abc123');
    });

    it('is case-insensitive on the scheme', () => {
        expect(bearerFromHeader('bearer abc123')).toBe('abc123');
    });

    it('returns undefined for a missing or non-Bearer header', () => {
        expect(bearerFromHeader(undefined)).toBeUndefined();
        expect(bearerFromHeader('Basic abc123')).toBeUndefined();
    });
});

describe('tokenMatches', () => {
    it('matches identical tokens', () => {
        expect(tokenMatches('secret', 'secret')).toBe(true);
    });

    it('rejects a wrong token', () => {
        expect(tokenMatches('wrong', 'secret')).toBe(false);
    });

    it('rejects an empty presented token even against an empty expected one', () => {
        expect(tokenMatches('', '')).toBe(false);
    });
});
```

```ts
// test/app.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/endpointAuth.test.ts test/app.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write src/mcp/endpointAuth.ts**

```ts
import { timingSafeEqual } from 'node:crypto';

export function bearerFromHeader(header: string | undefined): string | undefined {
    const [scheme, value] = (header ?? '').split(' ');
    return scheme?.toLowerCase() === 'bearer' ? (value ?? '') : undefined;
}

export function tokenMatches(presented: string, expected: string): boolean {
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    if (a.length === 0 || a.length !== b.length) {
        timingSafeEqual(b, b);
        return false;
    }
    return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Write src/core/logger.ts**

```ts
import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
```

- [ ] **Step 5: Write src/app.ts**

```ts
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Config } from './config/schema.ts';
import { bearerFromHeader, tokenMatches } from './mcp/endpointAuth.ts';
import { logger } from './core/logger.ts';

const NAME = 'tandoor-mcp';
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function buildApp(opts: { config: Config; buildServer: () => McpServer }): Hono {
    const { config } = opts;
    const handler = createMcpHandler(opts.buildServer);
    const transport = createMcpHonoApp({ host: '0.0.0.0' });

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
    app.route('/', transport);

    app.get('/healthz', c => c.json({ status: 'ok', name: NAME, version: process.env.TANDOOR_MCP_VERSION ?? '0.0.0-dev' }));

    app.use('*', async (c: Context, next) => {
        const allowed = config.mcp.allowed_hosts;
        if (allowed.length === 0) return next();
        const host = (c.req.header('host') ?? '').toLowerCase();
        const bare = host.replace(/:\d{1,5}$/, '');
        if (allowed.some(a => a.toLowerCase() === host || a.toLowerCase() === bare)) return next();
        logger.warn({ host }, 'rejected request with an unlisted Host');
        return c.text('forbidden: Host not allowed', 403);
    });

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
```

Note for the implementer: `createMcpHonoApp`'s and `createMcpHandler`'s exact call signatures depend on the installed `@modelcontextprotocol/hono`/`@modelcontextprotocol/server` versions — check `node_modules/@modelcontextprotocol/{hono,server}/dist/*.d.ts` if this does not compile as written, and adjust the wiring to match while keeping the behavior (bearer check before the handler runs, `/healthz` unauthenticated, Host allowlist) identical. Do not drop the streaming-vs-plain-JSON negotiation arr-mcp's `src/mcp/plainJson.ts` handles for older clients unless `test/app.test.ts` and manual testing with a real MCP client (Task 23) show no client in use needs it — treat that as a deferred hardening item, not a silent omission, and note it in `docs/security.md`'s "what this page does not cover" if it stays deferred.

- [ ] **Step 6: Write src/bootstrap.ts**

```ts
import type { Hono } from 'hono';
import { buildApp } from './app.ts';
import { loadConfig } from './config/load.ts';
import { WriteAudit } from './core/audit.ts';
import type { McpServer } from '@modelcontextprotocol/server';

export async function bootstrap(configDir: string, buildServer: () => McpServer): Promise<{ app: Hono; audit: WriteAudit }> {
    const config = loadConfig(configDir);
    const audit = WriteAudit.open(configDir);
    const app = buildApp({ config, buildServer });
    return { app, audit };
}
```

- [ ] **Step 7: Write src/index.ts**

```ts
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/server';
import { bootstrap } from './bootstrap.ts';
import { ConfigInvalidError } from './config/load.ts';
import { logger } from './core/logger.ts';

const CONFIG_DIR = process.env.TANDOOR_MCP_CONFIG_DIR ?? '/config';
const VERSION = process.env.TANDOOR_MCP_VERSION ?? '0.0.0-dev';

/** host, port from a `host:port` string, stripping the port from the end
 *  (not the first colon) so an IPv6 literal like `[::1]:6061` parses right. */
function parseBindAddr(addr: string): { hostname: string; port: number } {
    const match = /^(.*):(\d{1,5})$/.exec(addr);
    if (!match) throw new Error(`invalid bind_addr "${addr}", expected host:port`);
    return { hostname: match[1] as string, port: Number(match[2]) };
}

const buildServer = () =>
    new McpServer(
        { name: 'tandoor-mcp', version: VERSION },
        { instructions: 'An MCP server for Tandoor Recipes.', capabilities: { tools: { listChanged: false } } }
    );

try {
    const { app } = await bootstrap(CONFIG_DIR, buildServer);
    const { loadConfig } = await import('./config/load.ts');
    const { hostname, port } = parseBindAddr(loadConfig(CONFIG_DIR).mcp.bind_addr);
    serve({ fetch: app.fetch, hostname, port }, info => {
        logger.info({ port: info.port }, 'tandoor-mcp listening');
    });
} catch (err) {
    if (err instanceof ConfigInvalidError) {
        logger.error({ detail: err.detail }, 'config.yaml is invalid — see config.example.yaml for the expected shape');
        process.exit(1);
    }
    throw err;
}
```

Simplify this in review: `bootstrap` already calls `loadConfig` once; re-importing and re-calling it in `index.ts` to get `bind_addr` is redundant. Change `bootstrap`'s return type to include `config: Config` (`{ app, audit, config }`) and use `bootstrapped.config.mcp.bind_addr` in `index.ts` instead of loading twice. Update `test/app.test.ts` unaffected (it calls `buildApp` directly, not `bootstrap`).

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run test/endpointAuth.test.ts test/app.test.ts`
Expected: PASS, all cases.

- [ ] **Step 9: Manual smoke test**

```bash
mkdir -p /tmp/tandoor-mcp-config
cat > /tmp/tandoor-mcp-config/config.yaml <<'EOF'
tandoor:
  url: https://recipes.example.com
  token: dummy
mcp:
  bearer_token: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EOF
TANDOOR_MCP_CONFIG_DIR=/tmp/tandoor-mcp-config npm run dev
```

In another terminal:

```bash
curl -s localhost:6061/healthz
curl -s -o /dev/null -w '%{http_code}\n' localhost:6061/mcp -X POST
curl -s -o /dev/null -w '%{http_code}\n' localhost:6061/mcp -X POST -H 'Authorization: Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
```

Expected: `{"status":"ok",...}`, then `401`, then something other than `401` (the exact success shape depends on the MCP handler with zero tools registered — a valid JSON-RPC response, not a 401, is what this step confirms).

- [ ] **Step 10: Commit**

```bash
git add src/mcp/endpointAuth.ts src/app.ts src/bootstrap.ts src/index.ts src/core/logger.ts test/endpointAuth.test.ts test/app.test.ts
git commit -m "Wire the HTTP app: bearer auth, healthz, Host allowlist, entrypoint"
```

**Phase 1 checkpoint:** `npm run typecheck && npm run lint && npm test` all pass, and the manual smoke test in Step 9 confirms the server boots and enforces its bearer token. This is the point to pause and have a human review before Phase 2 adds Tandoor-specific tools on top of this foundation.

---

## Phase 2 — Read tools

Six read tools, plus the `TandoorClient` methods each needs, built incrementally rather than upfront. Every test in this phase uses an injected fake `fetch` with inline JSON matching Tandoor's confirmed real response shapes (verified against two independent existing Tandoor MCP implementations during design) — no committed fixture files yet; those come in Task 28.

### Task 9: TandoorClient core + search_recipes

**Files:**
- Create: `src/client/types.ts`
- Create: `src/client/tandoorClient.ts`
- Create: `src/tools/searchRecipes.ts`
- Create: `test/helpers/serve.ts`
- Test: `test/tandoorClient.test.ts`
- Test: `test/searchRecipes.test.ts`

**Interfaces:**
- Consumes: `TandoorHttp` from `src/core/http.ts` (Task 4); `fenceText` from `src/core/fence.ts` (Task 3); `LimitSchema`, `OffsetSchema`, `READ_ONLY`, `toolInput`, `TruncationSchema`, `applyLimit`, `listText` from `src/core/shape.ts` (Task 6)
- Produces:
  - `test/helpers/serve.ts`: `function jsonResponse(body: unknown, status?: number): Response`, `function serving(routes: Record<string, unknown>): typeof fetch`
  - `src/client/types.ts`: `type PaginatedResponse<T> = { count: number; next: string | null; previous: string | null; results: T[] }`, `type RecipeSummary`, `type Recipe`, `type Keyword`, `type Food`, `type Unit`, `type MealType`, `type MealPlan`, `type ShoppingListEntry`, `type CookLog` (fields per the confirmed Tandoor API shapes below)
  - `src/client/tandoorClient.ts`: `class TandoorClient { constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl?: typeof fetch); searchRecipes(opts: { query?: string; keywordId?: number; foodId?: number; rating?: number; limit?: number }): Promise<PaginatedResponse<RecipeSummary>> }`
  - `src/tools/searchRecipes.ts`: `function registerSearchRecipes(server: McpServer, client: TandoorClient): void`

**Confirmed Tandoor API shapes used in this task** (from `/api/recipe/`, verified against two independent working Tandoor MCP client implementations):

```
GET /api/recipe/?query=<q>&rating=<0-5>&keywords_or=<id>&foods_or=<id>&page_size=<n>
  -> { count, next, previous, results: [{ id, name, description, rating, servings, keywords: [{id, name}] }] }
```

- [ ] **Step 1: Write test/helpers/serve.ts (not a test itself — shared test infrastructure, used by every tool test from here on)**

```ts
export const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake fetch answering a path[+query]->body map, 404 for anything else. */
export const serving = (routes: Record<string, unknown>): typeof fetch =>
    (async (input: string | URL | Request) => {
        const raw = input instanceof Request ? input.url : String(input);
        const url = new URL(raw);
        const withQuery = `${url.pathname}${url.search}`;
        const key = withQuery in routes ? withQuery : url.pathname;
        if (!(key in routes)) return jsonResponse({ detail: 'not found' }, 404);
        return jsonResponse(routes[key]);
    }) as unknown as typeof fetch;
```

- [ ] **Step 2: Write src/client/types.ts**

```ts
export type PaginatedResponse<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export type Keyword = { id: number; name: string; description?: string | null };
export type Unit = { id: number; name: string; plural_name?: string | null; description?: string | null };
export type Food = { id: number; name: string; plural_name?: string | null; description?: string | null; food_onhand: boolean };
export type MealType = { id: number; name: string; order: number; color?: string; icon?: string | null };

export type RecipeSummary = {
    id: number;
    name: string;
    description?: string | null;
    rating?: number | null;
    servings?: number | null;
    keywords: Keyword[];
};

export type StepIngredient = {
    id: number;
    food: Food;
    unit: Unit | null;
    amount: number;
    note?: string | null;
    is_header: boolean;
    no_amount: boolean;
};

export type Step = { id: number; name: string; instruction: string; ingredients: StepIngredient[]; order: number };

export type Recipe = RecipeSummary & {
    steps: Step[];
    working_time?: number | null;
    waiting_time?: number | null;
    created_at?: string;
    updated_at?: string;
};

export type MealPlan = {
    id: number;
    title?: string | null;
    recipe: RecipeSummary | null;
    servings: number;
    note?: string | null;
    date: string;
    meal_type: MealType;
};

export type ShoppingListEntry = {
    id: number;
    food: Food;
    unit: Unit | null;
    amount: number;
    checked: boolean;
    created?: string;
};

export type CookLog = {
    id: number;
    recipe: RecipeSummary;
    servings: number;
    rating?: number | null;
    comment?: string | null;
    created: string;
};
```

- [ ] **Step 3: Write the failing test for TandoorClient.searchRecipes**

```ts
// test/tandoorClient.test.ts
import { describe, expect, it } from 'vitest';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { serving } from './helpers/serve.ts';

describe('TandoorClient.searchRecipes', () => {
    it('builds the query string from query/rating/limit and returns results', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=pasta&rating=4&page_size=10': {
                count: 1,
                next: null,
                previous: null,
                results: [{ id: 1, name: 'Pasta', description: 'Tasty', rating: 4, servings: 2, keywords: [] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const result = await client.searchRecipes({ query: 'pasta', rating: 4, limit: 10 });
        expect(result.count).toBe(1);
        expect(result.results[0]?.name).toBe('Pasta');
    });

    it('adds keywords_or and foods_or when keywordId/foodId are given', async () => {
        const fetchImpl = serving({
            '/api/recipe/?keywords_or=3&foods_or=7&page_size=50': { count: 0, next: null, previous: null, results: [] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.searchRecipes({ keywordId: 3, foodId: 7 })).resolves.toMatchObject({ count: 0 });
    });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Write src/client/tandoorClient.ts (this task's slice — searchRecipes only; later tasks add methods to this same class)**

```ts
import { TandoorHttp } from '../core/http.ts';
import type { PaginatedResponse, RecipeSummary } from './types.ts';

export class TandoorClient {
    readonly #http: TandoorHttp;

    constructor(baseUrl: string, token: string, timeoutMs: number, fetchImpl?: typeof fetch) {
        this.#http = new TandoorHttp(baseUrl, token, timeoutMs, fetchImpl);
    }

    async searchRecipes(opts: { query?: string; keywordId?: number; foodId?: number; rating?: number; limit?: number }): Promise<PaginatedResponse<RecipeSummary>> {
        const params = new URLSearchParams();
        if (opts.query !== undefined) params.set('query', opts.query);
        if (opts.keywordId !== undefined) params.set('keywords_or', String(opts.keywordId));
        if (opts.foodId !== undefined) params.set('foods_or', String(opts.foodId));
        if (opts.rating !== undefined) params.set('rating', String(opts.rating));
        params.set('page_size', String(opts.limit ?? 50));
        return this.#http.get(`/api/recipe/?${params.toString()}`);
    }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: PASS.

- [ ] **Step 7: Write the failing test for the search_recipes tool**

```ts
// test/searchRecipes.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerSearchRecipes } from '../src/tools/searchRecipes.ts';
import { serving } from './helpers/serve.ts';

describe('search_recipes tool', () => {
    it('returns a windowed, fenced list of recipes', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=pasta&page_size=50': {
                count: 1,
                next: null,
                previous: null,
                results: [{ id: 1, name: 'Pasta <script>', description: 'Tasty <b>bold</b>', rating: 4, servings: 2, keywords: [] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSearchRecipes(server, client);

        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'search_recipes', arguments: { query: 'pasta' } } },
            z.any()
        )) as { structuredContent: { items: Array<{ description: string }>; total: number } };

        expect(result.structuredContent.total).toBe(1);
        expect(result.structuredContent.items[0]?.description).toContain('tandoor.description');
        expect(result.structuredContent.items[0]?.description).not.toContain('<b>');
    });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run test/searchRecipes.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 9: Write src/tools/searchRecipes.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const project = (recipe: { id: number; name: string; description?: string | null; rating?: number | null; servings?: number | null; keywords: { name: string }[] }) => ({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description ? fenceText(recipe.description, 'description') : '',
    rating: recipe.rating ?? null,
    servings: recipe.servings ?? null,
    keywords: recipe.keywords.map(k => k.name)
});

export function registerSearchRecipes(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'search_recipes',
        {
            title: 'Search recipes',
            annotations: READ_ONLY,
            description:
                'Search Tandoor recipes by name, keyword, food, or minimum rating. `description` is untrusted free text from whoever authored the recipe and is fenced accordingly.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                query: z.string().optional().describe('Search term matched against recipe name and description.'),
                keyword: z.string().optional().describe('Keyword name to filter by (resolved to an id server-side).'),
                food: z.string().optional().describe('Food name to filter by (resolved to an id server-side).'),
                rating: z.number().min(0).max(5).optional().describe('Minimum rating, 0-5.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ query, keyword, food, rating, limit, offset }) => {
            let keywordId: number | undefined;
            if (keyword !== undefined) {
                const found = await client.searchKeywords(keyword, 1);
                keywordId = found.results[0]?.id;
            }
            let foodId: number | undefined;
            if (food !== undefined) {
                const found = await client.searchFoods(food, 1);
                foodId = found.results[0]?.id;
            }

            const response = await client.searchRecipes({ query, keywordId, foodId, rating, limit: 500 });
            const shaped = applyLimit(response.results.map(project), limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} recipe(s)${query ? ` matching "${query}"` : ''}.`;

            return {
                content: [{ type: 'text', text: listText(summary, shaped.items, r => `#${r.id} ${r.name}`) }],
                structuredContent: shaped
            };
        }
    );
}
```

This introduces two more `TandoorClient` methods used only here — `searchKeywords` and `searchFoods` — which Task 11 also needs and formally adds; add minimal versions now:

```ts
// append to src/client/tandoorClient.ts, inside the TandoorClient class
async searchKeywords(query: string, limit = 50): Promise<PaginatedResponse<Keyword>> {
    const params = new URLSearchParams({ query, page_size: String(limit) });
    return this.#http.get(`/api/keyword/?${params.toString()}`);
}

async searchFoods(query: string, limit = 50): Promise<PaginatedResponse<Food>> {
    const params = new URLSearchParams({ query, page_size: String(limit) });
    return this.#http.get(`/api/food/?${params.toString()}`);
}
```

Add the matching import (`Keyword, Food`) to `src/client/tandoorClient.ts`'s type import line, and extend `test/tandoorClient.test.ts` with two more cases covering these before moving on:

```ts
it('searchKeywords hits /api/keyword/', async () => {
    const fetchImpl = serving({ '/api/keyword/?query=dinner&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 9, name: 'dinner' }] } });
    const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
    await expect(client.searchKeywords('dinner', 1)).resolves.toMatchObject({ count: 1 });
});

it('searchFoods hits /api/food/', async () => {
    const fetchImpl = serving({ '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 4, name: 'egg', food_onhand: false }] } });
    const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
    await expect(client.searchFoods('egg', 1)).resolves.toMatchObject({ count: 1 });
});
```

- [ ] **Step 10: Run all new/changed tests to verify they pass**

Run: `npx vitest run test/tandoorClient.test.ts test/searchRecipes.test.ts`
Expected: PASS, all cases.

- [ ] **Step 11: Run the full suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add src/client test/helpers/serve.ts src/tools/searchRecipes.ts test/tandoorClient.test.ts test/searchRecipes.test.ts
git commit -m "Add TandoorClient core and the search_recipes tool"
```

---

### Task 10: get_recipe (with servings scaling)

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getRecipe`)
- Create: `src/tools/getRecipe.ts`
- Test: `test/tandoorClient.test.ts` (add cases)
- Test: `test/getRecipe.test.ts`

**Interfaces:**
- Produces: `TandoorClient.getRecipe(id: number): Promise<Recipe>`; `function registerGetRecipe(server: McpServer, client: TandoorClient): void`

**Confirmed shape:** `GET /api/recipe/{id}/ -> Recipe` (see `src/client/types.ts`'s `Recipe`, `Step`, `StepIngredient`).

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.getRecipe', () => {
    it('fetches a single recipe by id', async () => {
        const fetchImpl = serving({
            '/api/recipe/1/': {
                id: 1,
                name: 'Pasta',
                description: 'Tasty',
                rating: 4,
                servings: 2,
                keywords: [],
                steps: [{ id: 1, name: '', instruction: 'Boil water.', order: 1, ingredients: [{ id: 1, food: { id: 1, name: 'pasta', food_onhand: false }, unit: { id: 1, name: 'g' }, amount: 200, is_header: false, no_amount: false }] }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const recipe = await client.getRecipe(1);
        expect(recipe.steps[0]?.ingredients[0]?.amount).toBe(200);
    });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: FAIL — `getRecipe` is not a function.

- [ ] **Step 3: Add getRecipe to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class, add `Recipe` to the type import
async getRecipe(id: number): Promise<Recipe> {
    return this.#http.get(`/api/recipe/${id}/`);
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/getRecipe.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetRecipe } from '../src/tools/getRecipe.ts';
import { serving } from './helpers/serve.ts';

const RECIPE = {
    id: 1,
    name: 'Pasta',
    description: 'Tasty',
    rating: 4,
    servings: 2,
    keywords: [],
    steps: [
        {
            id: 1,
            name: '',
            instruction: 'Boil the pasta.',
            order: 1,
            ingredients: [{ id: 1, food: { id: 1, name: 'pasta', food_onhand: false }, unit: { id: 1, name: 'g' }, amount: 200, is_header: false, no_amount: false }]
        }
    ]
};

describe('get_recipe tool', () => {
    it('returns the recipe unscaled when no servings argument is given', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/recipe/1/': RECIPE }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetRecipe(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_recipe', arguments: { id: 1 } } }, z.any())) as {
            structuredContent: { ingredients: Array<{ amount: number }>; scaling_applied: boolean };
        };
        expect(result.structuredContent.ingredients[0]?.amount).toBe(200);
        expect(result.structuredContent.scaling_applied).toBe(false);
    });

    it('scales ingredient amounts to the requested servings', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/recipe/1/': RECIPE }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetRecipe(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_recipe', arguments: { id: 1, servings: 4 } } }, z.any())) as {
            structuredContent: { ingredients: Array<{ amount: number }>; scaling_applied: boolean };
        };
        expect(result.structuredContent.ingredients[0]?.amount).toBe(400);
        expect(result.structuredContent.scaling_applied).toBe(true);
    });
});
```

- [ ] **Step 6: Run, verify it fails**

Run: `npx vitest run test/getRecipe.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Write src/tools/getRecipe.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { READ_ONLY, toolInput } from '../core/shape.ts';

export function registerGetRecipe(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_recipe',
        {
            title: 'Get recipe details',
            annotations: READ_ONLY,
            description:
                'Full detail for one recipe: instructions and ingredients. Pass `servings` to scale every ingredient amount to that serving count; omit it to get the recipe as written. `description` and each instruction are untrusted free text and are fenced.',
            inputSchema: toolInput({
                id: z.number().int().positive().describe('The recipe id, from search_recipes.'),
                servings: z.number().positive().optional().describe('Scale ingredient amounts to this many servings.')
            })
        },
        async ({ id, servings }) => {
            const recipe = await client.getRecipe(id);
            const original = recipe.servings ?? 1;
            const factor = servings !== undefined ? servings / original : 1;

            const ingredients = recipe.steps.flatMap(step =>
                step.ingredients.map(ing => ({
                    food: ing.food.name,
                    amount: ing.amount * factor,
                    unit: ing.unit?.name ?? null,
                    note: ing.note ? fenceText(ing.note, 'ingredient_note') : null,
                    is_header: ing.is_header,
                    no_amount: ing.no_amount
                }))
            );

            const instructions = recipe.steps.map(step => fenceText(step.instruction, 'step_instruction'));

            const result = {
                id: recipe.id,
                name: recipe.name,
                description: recipe.description ? fenceText(recipe.description, 'description') : '',
                servings: servings ?? original,
                working_time: recipe.working_time ?? null,
                waiting_time: recipe.waiting_time ?? null,
                keywords: recipe.keywords.map(k => k.name),
                instructions,
                ingredients,
                scaling_applied: factor !== 1
            };

            return { content: [{ type: 'text', text: `${result.name} — ${ingredients.length} ingredient(s), ${instructions.length} step(s).` }], structuredContent: result };
        }
    );
}
```

- [ ] **Step 8: Run, verify it passes**

Run: `npx vitest run test/getRecipe.test.ts`
Expected: PASS, both cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/getRecipe.ts test/getRecipe.test.ts
git commit -m "Add get_recipe with servings scaling"
```

---

### Task 11: list_reference_data (keyword | unit | food | meal_type)

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getUnits`, `getMealTypes`; `searchKeywords`/`searchFoods` already exist from Task 9)
- Create: `src/tools/listReferenceData.ts`
- Test: `test/tandoorClient.test.ts` (add cases)
- Test: `test/listReferenceData.test.ts`

**Interfaces:**
- Produces: `TandoorClient.getUnits(query?: string, limit?: number): Promise<PaginatedResponse<Unit>>`; `TandoorClient.getMealTypes(): Promise<PaginatedResponse<MealType>>`; `function registerListReferenceData(server: McpServer, client: TandoorClient): void`

**Confirmed shapes:** `GET /api/unit/?query=&page_size=`, `GET /api/meal-type/` (no query support — Tandoor returns the full, small list).

- [ ] **Step 1: Add failing client tests**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.getUnits', () => {
    it('hits /api/unit/', async () => {
        const fetchImpl = serving({ '/api/unit/?page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'cup' }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getUnits()).resolves.toMatchObject({ count: 1 });
    });
});

describe('TandoorClient.getMealTypes', () => {
    it('hits /api/meal-type/', async () => {
        const fetchImpl = serving({ '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Dinner', order: 1 }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealTypes()).resolves.toMatchObject({ count: 1 });
    });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add methods to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class, add `Unit, MealType` to the type import
async getUnits(query?: string, limit = 50): Promise<PaginatedResponse<Unit>> {
    const params = new URLSearchParams({ page_size: String(limit) });
    if (query !== undefined) params.set('query', query);
    return this.#http.get(`/api/unit/?${params.toString()}`);
}

async getMealTypes(): Promise<PaginatedResponse<MealType>> {
    return this.#http.get('/api/meal-type/');
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run test/tandoorClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/listReferenceData.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerListReferenceData } from '../src/tools/listReferenceData.ts';
import { serving } from './helpers/serve.ts';

async function callTool(client: TandoorClient, kind: string, extra: Record<string, unknown> = {}) {
    const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    registerListReferenceData(server, client);
    return server.server.request({ method: 'tools/call', params: { name: 'list_reference_data', arguments: { kind, ...extra } } }, z.any()) as Promise<{
        structuredContent: { items: unknown[]; total: number };
    }>;
}

describe('list_reference_data tool', () => {
    it('lists keywords', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/keyword/?query=&page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'quick' }] } }));
        const result = await callTool(client, 'keyword');
        expect(result.structuredContent.total).toBe(1);
    });

    it('lists units', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/unit/?page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'cup' }] } }));
        const result = await callTool(client, 'unit');
        expect(result.structuredContent.total).toBe(1);
    });

    it('lists foods', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/food/?query=&page_size=50': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] } }));
        const result = await callTool(client, 'food');
        expect(result.structuredContent.total).toBe(1);
    });

    it('lists meal types', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Dinner', order: 1 }] } }));
        const result = await callTool(client, 'meal_type');
        expect(result.structuredContent.total).toBe(1);
    });
});
```

- [ ] **Step 6: Run, verify failure**

Run: `npx vitest run test/listReferenceData.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Write src/tools/listReferenceData.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { LimitSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const KIND = ['keyword', 'unit', 'food', 'meal_type'] as const;

export function registerListReferenceData(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'list_reference_data',
        {
            title: 'List reference data',
            annotations: READ_ONLY,
            description: 'Looks up Tandoor vocabulary the other tools take as input: keywords, units, foods, or meal types. Use before create_recipe/plan_meals when you need an exact spelling rather than guessing.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                kind: z.enum(KIND).describe('Which vocabulary to list.'),
                query: z.string().optional().describe('Optional search term (ignored for meal_type, which is always a short fixed list).'),
                limit: LimitSchema
            })
        },
        async ({ kind, query, limit }) => {
            const items = await fetchByKind(client, kind, query, limit);
            const shaped = applyLimit(items, limit);
            const summary = `${shaped.returned} of ${shaped.total} ${kind}(s).`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, (i: { name: string }) => i.name) }], structuredContent: shaped };
        }
    );
}

async function fetchByKind(client: TandoorClient, kind: (typeof KIND)[number], query: string | undefined, limit: number): Promise<{ id: number; name: string }[]> {
    if (kind === 'keyword') return (await client.searchKeywords(query ?? '', limit)).results;
    if (kind === 'unit') return (await client.getUnits(query, limit)).results;
    if (kind === 'food') return (await client.searchFoods(query ?? '', limit)).results;
    return (await client.getMealTypes()).results;
}
```

- [ ] **Step 8: Run, verify pass**

Run: `npx vitest run test/listReferenceData.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/listReferenceData.ts test/listReferenceData.test.ts
git commit -m "Add list_reference_data: keywords, units, foods, meal types"
```

---

### Task 12: get_meal_plan

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getMealPlans`)
- Create: `src/tools/getMealPlan.ts`
- Test: `test/tandoorClient.test.ts`, `test/getMealPlan.test.ts`

**Interfaces:** `TandoorClient.getMealPlans(fromDate: string, toDate: string): Promise<PaginatedResponse<MealPlan>>`; `function registerGetMealPlan(server: McpServer, client: TandoorClient): void`

**Confirmed shape:** `GET /api/meal-plan/?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD`.

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.getMealPlans', () => {
    it('hits /api/meal-plan/ with from_date/to_date', async () => {
        const fetchImpl = serving({
            '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': {
                count: 1, next: null, previous: null,
                results: [{ id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealPlans('2026-01-01', '2026-01-07')).resolves.toMatchObject({ count: 1 });
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/tandoorClient.test.ts` — expected FAIL.

- [ ] **Step 3: Add getMealPlans to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class, add `MealPlan` to the type import
async getMealPlans(fromDate: string, toDate: string): Promise<PaginatedResponse<MealPlan>> {
    const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
    return this.#http.get(`/api/meal-plan/?${params.toString()}`);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/tandoorClient.test.ts` — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/getMealPlan.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetMealPlan } from '../src/tools/getMealPlan.ts';
import { serving } from './helpers/serve.ts';

const PLANS = {
    count: 2, next: null, previous: null,
    results: [
        { id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: 'note <b>x</b>', date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } },
        { id: 2, title: null, recipe: { id: 2, name: 'Salad', keywords: [] }, servings: 1, note: null, date: '2026-01-02', meal_type: { id: 2, name: 'Lunch', order: 2 } }
    ]
};

describe('get_meal_plan tool', () => {
    it('returns entries in the date range', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': PLANS }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_meal_plan', arguments: { from_date: '2026-01-01', to_date: '2026-01-07' } } }, z.any())) as {
            structuredContent: { items: Array<{ meal_type: string; note: string }>; total: number };
        };
        expect(result.structuredContent.total).toBe(2);
        expect(result.structuredContent.items[0]?.note).toContain('tandoor.note');
    });

    it('filters client-side by meal_type name', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-plan/?from_date=2026-01-01&to_date=2026-01-07': PLANS }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_meal_plan', arguments: { from_date: '2026-01-01', to_date: '2026-01-07', meal_type: 'dinner' } } }, z.any())) as {
            structuredContent: { total: number };
        };
        expect(result.structuredContent.total).toBe(1);
    });

    it('rejects a malformed date', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetMealPlan(server, client);
        await expect(
            server.server.request({ method: 'tools/call', params: { name: 'get_meal_plan', arguments: { from_date: 'not-a-date', to_date: '2026-01-07' } } }, z.any())
        ).rejects.toThrow();
    });
});
```

- [ ] **Step 6: Run, verify failure** — `npx vitest run test/getMealPlan.test.ts` — expected FAIL.

- [ ] **Step 7: Write src/tools/getMealPlan.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export function registerGetMealPlan(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_meal_plan',
        {
            title: 'Get meal plan',
            annotations: READ_ONLY,
            description: 'Meal plan entries for a date range, optionally filtered by meal type name (e.g. "Dinner").',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                from_date: DateSchema.describe('Start of the range, inclusive, YYYY-MM-DD.'),
                to_date: DateSchema.describe('End of the range, inclusive, YYYY-MM-DD.'),
                meal_type: z.string().optional().describe('Filter to entries whose meal type name matches, case-insensitive.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ from_date, to_date, meal_type, limit, offset }) => {
            const response = await client.getMealPlans(from_date, to_date);
            const filtered = response.results.filter(p => meal_type === undefined || p.meal_type.name.toLowerCase() === meal_type.toLowerCase());
            const projected = filtered.map(p => ({
                id: p.id,
                date: p.date,
                meal_type: p.meal_type.name,
                recipe_id: p.recipe?.id ?? null,
                recipe_name: p.recipe?.name ?? null,
                title: p.title ?? null,
                servings: p.servings,
                note: p.note ? fenceText(p.note, 'note') : null
            }));
            const shaped = applyLimit(projected, limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} meal plan entr${shaped.total === 1 ? 'y' : 'ies'} from ${from_date} to ${to_date}.`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, e => `${e.date} ${e.meal_type}: ${e.recipe_name ?? e.title ?? '(untitled)'}`) }], structuredContent: shaped };
        }
    );
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/getMealPlan.test.ts` — expected PASS, all three cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/getMealPlan.ts test/getMealPlan.test.ts
git commit -m "Add get_meal_plan"
```

---

### Task 13: get_shopping_list

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getShoppingList`)
- Create: `src/tools/getShoppingList.ts`
- Test: `test/tandoorClient.test.ts`, `test/getShoppingList.test.ts`

**Interfaces:** `TandoorClient.getShoppingList(): Promise<PaginatedResponse<ShoppingListEntry>>`; `function registerGetShoppingList(server: McpServer, client: TandoorClient): void`

**Confirmed shape:** `GET /api/shopping-list-entry/` — note both a paginated-object response and a bare-array response have been observed in the wild depending on Tandoor version/config (one existing implementation special-cases this). Handle both in the client.

- [ ] **Step 1: Add the failing client tests**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.getShoppingList', () => {
    it('returns results from a standard paginated response', async () => {
        const fetchImpl = serving({
            '/api/shopping-list-entry/': { count: 1, next: null, previous: null, results: [{ id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getShoppingList()).resolves.toMatchObject({ count: 1 });
    });

    it('normalizes a bare-array response (seen on some Tandoor versions when the list is empty)', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': [] });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getShoppingList()).resolves.toEqual({ count: 0, next: null, previous: null, results: [] });
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/tandoorClient.test.ts` — expected FAIL.

- [ ] **Step 3: Add getShoppingList to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class, add `ShoppingListEntry` to the type import
async getShoppingList(): Promise<PaginatedResponse<ShoppingListEntry>> {
    const raw = await this.#http.get<PaginatedResponse<ShoppingListEntry> | ShoppingListEntry[]>('/api/shopping-list-entry/');
    if (Array.isArray(raw)) return { count: raw.length, next: null, previous: null, results: raw };
    return raw;
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/tandoorClient.test.ts` — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/getShoppingList.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetShoppingList } from '../src/tools/getShoppingList.ts';
import { serving } from './helpers/serve.ts';

const LIST = {
    count: 2, next: null, previous: null,
    results: [
        { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false },
        { id: 2, food: { id: 2, name: 'milk', food_onhand: false }, unit: { id: 1, name: 'L' }, amount: 1, checked: true }
    ]
};

describe('get_shopping_list tool', () => {
    it('returns a flat list by default', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetShoppingList(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_shopping_list', arguments: {} } }, z.any())) as { structuredContent: { total: number } };
        expect(result.structuredContent.total).toBe(2);
    });

    it('groups by checked state when format is "grouped"', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetShoppingList(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_shopping_list', arguments: { format: 'grouped' } } }, z.any())) as {
            structuredContent: { unchecked_items: unknown[]; checked_items: unknown[] };
        };
        expect(result.structuredContent.unchecked_items).toHaveLength(1);
        expect(result.structuredContent.checked_items).toHaveLength(1);
    });
});
```

- [ ] **Step 6: Run, verify failure** — `npx vitest run test/getShoppingList.test.ts` — expected FAIL.

- [ ] **Step 7: Write src/tools/getShoppingList.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { READ_ONLY, toolInput } from '../core/shape.ts';

function project(entry: { id: number; food: { name: string; food_onhand: boolean }; unit: { name: string } | null; amount: number; checked: boolean }) {
    return { id: entry.id, food: entry.food.name, amount: entry.amount, unit: entry.unit?.name ?? null, checked: entry.checked, available: entry.food.food_onhand };
}

export function registerGetShoppingList(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_shopping_list',
        {
            title: 'Get shopping list',
            annotations: READ_ONLY,
            description: 'The current shopping list, flat or grouped by checked state.',
            inputSchema: toolInput({ format: z.enum(['flat', 'grouped']).default('flat').describe('flat: one array. grouped: split into unchecked_items and checked_items.') })
        },
        async ({ format }) => {
            const response = await client.getShoppingList();
            const items = response.results.map(project);

            if (format === 'grouped') {
                const unchecked = items.filter(i => !i.checked);
                const checked = items.filter(i => i.checked);
                const result = { unchecked_items: unchecked, checked_items: checked, total_items: response.count, format };
                return { content: [{ type: 'text', text: `${unchecked.length} unchecked, ${checked.length} checked.` }], structuredContent: result };
            }

            const result = { items, total_items: response.count, format };
            return { content: [{ type: 'text', text: `${items.length} shopping list item(s).` }], structuredContent: result };
        }
    );
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/getShoppingList.test.ts` — expected PASS, both cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/getShoppingList.ts test/getShoppingList.test.ts
git commit -m "Add get_shopping_list"
```

---

### Task 14: get_cook_log

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getCookLog`)
- Create: `src/tools/getCookLog.ts`
- Test: `test/tandoorClient.test.ts`, `test/getCookLog.test.ts`

**Interfaces:** `TandoorClient.getCookLog(opts: { recipeId?: number; fromDate?: string }): Promise<PaginatedResponse<CookLog>>`; `function registerGetCookLog(server: McpServer, client: TandoorClient): void`

**Confirmed shape:** `GET /api/cook-log/?recipe=<id>&from_date=YYYY-MM-DD`.

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.getCookLog', () => {
    it('hits /api/cook-log/ with recipe and from_date when given', async () => {
        const fetchImpl = serving({
            '/api/cook-log/?recipe=1&from_date=2026-01-01': {
                count: 1, next: null, previous: null,
                results: [{ id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'great', created: '2026-01-02T00:00:00Z' }]
            }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getCookLog({ recipeId: 1, fromDate: '2026-01-01' })).resolves.toMatchObject({ count: 1 });
    });

    it('omits filters that were not given', async () => {
        const fetchImpl = serving({ '/api/cook-log/': { count: 0, next: null, previous: null, results: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getCookLog({})).resolves.toMatchObject({ count: 0 });
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/tandoorClient.test.ts` — expected FAIL.

- [ ] **Step 3: Add getCookLog to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class, add `CookLog` to the type import
async getCookLog(opts: { recipeId?: number; fromDate?: string }): Promise<PaginatedResponse<CookLog>> {
    const params = new URLSearchParams();
    if (opts.recipeId !== undefined) params.set('recipe', String(opts.recipeId));
    if (opts.fromDate !== undefined) params.set('from_date', opts.fromDate);
    const query = params.toString();
    return this.#http.get(`/api/cook-log/${query ? `?${query}` : ''}`);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/tandoorClient.test.ts` — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/getCookLog.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerGetCookLog } from '../src/tools/getCookLog.ts';
import { serving } from './helpers/serve.ts';

describe('get_cook_log tool', () => {
    it('defaults days_back to 30 and converts it to a from_date filter', async () => {
        const fetchImpl = serving({ '/api/cook-log/?from_date=2025-12-18': { count: 0, next: null, previous: null, results: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetCookLog(server, client);
        // Fixed "now" via a days_back that resolves predictably is awkward without
        // mocking the clock; assert on the shape instead of the exact date here,
        // and add a clock-injected unit test on the tool's internal date math if
        // one is introduced later.
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_cook_log', arguments: {} } }, z.any())) as { structuredContent: { total: number } };
        expect(result.structuredContent.total).toBe(0);
    });

    it('fences a free-text comment', async () => {
        const fetchImpl = serving({
            '/api/cook-log/?recipe=1': { count: 1, next: null, previous: null, results: [{ id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'so <b>good</b>', created: '2026-01-02T00:00:00Z' }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerGetCookLog(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'get_cook_log', arguments: { recipe_id: 1, days_back: 0 } } }, z.any())) as {
            structuredContent: { items: Array<{ comment: string }> };
        };
        expect(result.structuredContent.items[0]?.comment).toContain('tandoor.comment');
    });
});
```

Note: the first test's route key assumes a `days_back: 30` default resolves to a `from_date` of `2025-12-18` — that is only correct on the date this plan was written. Replace it before running: compute the expected date from the real system clock (`new Date(Date.now() - 30*86400000).toISOString().slice(0,10)`) inside the test, or inject a clock into the tool the way `ConfirmTokens` does, rather than hardcoding a date that will silently rot.

- [ ] **Step 6: Run, verify failure** — `npx vitest run test/getCookLog.test.ts` — expected FAIL.

- [ ] **Step 7: Write src/tools/getCookLog.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { fenceText } from '../core/fence.ts';
import { LimitSchema, OffsetSchema, READ_ONLY, TruncationSchema, applyLimit, listText, toolInput } from '../core/shape.ts';

function daysAgo(days: number): string {
    const date = new Date(Date.now() - days * 86_400_000);
    return date.toISOString().slice(0, 10);
}

export function registerGetCookLog(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'get_cook_log',
        {
            title: 'Get cook log',
            annotations: READ_ONLY,
            description: 'Cooking history, optionally filtered to one recipe and/or a lookback window.',
            outputSchema: TruncationSchema,
            inputSchema: toolInput({
                recipe_id: z.number().int().positive().optional().describe('Restrict to this recipe.'),
                days_back: z.number().int().min(0).default(30).describe('How many days back to look. 0 disables the date filter.'),
                limit: LimitSchema,
                offset: OffsetSchema
            })
        },
        async ({ recipe_id, days_back, limit, offset }) => {
            const response = await client.getCookLog({ recipeId: recipe_id, fromDate: days_back > 0 ? daysAgo(days_back) : undefined });
            const projected = response.results.map(log => ({
                id: log.id,
                recipe_id: log.recipe.id,
                recipe_name: log.recipe.name,
                servings: log.servings,
                rating: log.rating ?? null,
                comment: log.comment ? fenceText(log.comment, 'comment') : null,
                created: log.created
            }));
            const shaped = applyLimit(projected, limit, offset);
            const summary = `${shaped.returned} of ${shaped.total} cook log entr${shaped.total === 1 ? 'y' : 'ies'}.`;
            return { content: [{ type: 'text', text: listText(summary, shaped.items, e => `${e.created.slice(0, 10)} ${e.recipe_name}${e.rating !== null ? ` (${e.rating}/5)` : ''}`) }], structuredContent: shaped };
        }
    );
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/getCookLog.test.ts` — expected PASS.

- [ ] **Step 9: Run the full suite** — `npm run typecheck && npm run lint && npm test` — expected all pass.

- [ ] **Step 10: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/getCookLog.ts test/getCookLog.test.ts
git commit -m "Add get_cook_log"
```

**Phase 2 checkpoint:** six read tools registered against a growing `TandoorClient`, all tests green with no live Tandoor instance touched. Good point for a human review before Phase 3 adds writes.

---

## Phase 3 — Write tools

Every tool here is registered through `registerWriteTool` (Task 7): each supplies a `plan()` (pure, resolves names to ids, describes the effect) and an `apply()` (only reached after permission + confirm). `plan()` resolves everything `apply()` needs and hands it through `WritePlan.args`, so `apply()` never re-resolves a name — avoiding a race where two similarly-named foods get created between preview and confirm.

### Task 15: create_recipe

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `createFood`, `resolveFoodId`, `createUnit`, `resolveUnitId`, `createRecipe`)
- Create: `src/tools/createRecipe.ts` (also exports `parseIngredientLine` for direct testing)
- Test: `test/tandoorClient.test.ts`, `test/createRecipe.test.ts`

**Interfaces:**
- Consumes: `registerWriteTool`, `WriteContext`, `WritePlan` from `src/tools/write.ts` (Task 7)
- Produces:
  - `TandoorClient.createFood(name: string): Promise<Food>`
  - `TandoorClient.resolveFoodId(name: string): Promise<{ id: number; name: string }>` — searches first; creates only if no result
  - `TandoorClient.createUnit(name: string): Promise<Unit>`
  - `TandoorClient.resolveUnitId(name: string): Promise<{ id: number; name: string }>`
  - `TandoorClient.createRecipe(payload: CreateRecipeRequest): Promise<Recipe>`
  - `function parseIngredientLine(line: string): { amount: string; unit?: string; food: string; note?: string }`
  - `function registerCreateRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Confirmed shapes:** `POST /api/food/ {name} -> Food`, `POST /api/unit/ {name} -> Unit` (both are standard DRF create endpoints backing the same resources `GET /api/food/` and `GET /api/unit/` already confirmed; neither existing Tandoor MCP implementation exercises the POST, so verify this against the real OpenAPI spec / a live call during Task 28 — if the shape differs, this is the one place in the plan to revisit, not a silent assumption elsewhere). `POST /api/recipe/ {name, description, servings, working_time, waiting_time, keywords: [{name}], steps: [{name, instruction, order, ingredients: [{food:{id,name}, unit:{id,name}|null, amount, note, order, is_header, no_amount}]}]} -> Recipe`.

**The ingredient line parser** (a deliberately simple v1 — comment its ceiling and upgrade path where it lives): each line is `[amount] [unit] food [(note)]`. A leading integer, decimal, simple fraction (`1/2`) or mixed number (`1 1/2`) is the amount; if at least two words remain after it, the first is treated as the unit and the rest as the food name; otherwise there is no unit and the whole remainder is the food name. A trailing `(...)` is a note. A line with no leading amount defaults to amount `"1"` with no unit.

- [ ] **Step 1: Add the failing client tests**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient food/unit resolution', () => {
    it('resolveFoodId returns an existing food without creating one', async () => {
        const fetchImpl = serving({ '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 4, name: 'egg', food_onhand: false }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveFoodId('egg')).resolves.toEqual({ id: 4, name: 'egg' });
    });

    it('resolveFoodId creates a food when none is found', async () => {
        const fetchImpl = serving({
            '/api/food/?query=durian&page_size=1': { count: 0, next: null, previous: null, results: [] },
            '/api/food/': { id: 99, name: 'durian', food_onhand: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveFoodId('durian')).resolves.toEqual({ id: 99, name: 'durian' });
    });

    it('resolveUnitId returns an existing unit without creating one', async () => {
        const fetchImpl = serving({ '/api/unit/?query=cup&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'cup' }] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.resolveUnitId('cup')).resolves.toEqual({ id: 2, name: 'cup' });
    });
});

describe('TandoorClient.createRecipe', () => {
    it('posts to /api/recipe/ and returns the created recipe', async () => {
        const fetchImpl = serving({ '/api/recipe/': { id: 5, name: 'New Recipe', keywords: [], steps: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const recipe = await client.createRecipe({ name: 'New Recipe', description: '', servings: 2, working_time: 0, waiting_time: 0, keywords: [], steps: [] });
        expect(recipe.id).toBe(5);
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/tandoorClient.test.ts` — expected FAIL.

- [ ] **Step 3: Add the new methods and types to src/client/tandoorClient.ts and src/client/types.ts**

```ts
// append to src/client/types.ts
export type CreateStepIngredientRequest = {
    food: { id: number; name: string };
    unit: { id: number; name: string } | null;
    amount: string;
    note?: string;
    order: number;
    is_header: boolean;
    no_amount: boolean;
};
export type CreateStepRequest = { name?: string; instruction: string; order: number; ingredients: CreateStepIngredientRequest[] };
export type CreateRecipeRequest = {
    name: string;
    description?: string;
    servings?: number;
    working_time: number;
    waiting_time: number;
    keywords: { name: string }[];
    steps: CreateStepRequest[];
};
```

```ts
// append inside the TandoorClient class in src/client/tandoorClient.ts
async createFood(name: string): Promise<Food> {
    return this.#http.post('/api/food/', { name });
}

async resolveFoodId(name: string): Promise<{ id: number; name: string }> {
    const found = await this.searchFoods(name, 1);
    const match = found.results[0];
    if (match !== undefined) return { id: match.id, name: match.name };
    const created = await this.createFood(name);
    return { id: created.id, name: created.name };
}

async createUnit(name: string): Promise<Unit> {
    return this.#http.post('/api/unit/', { name });
}

async resolveUnitId(name: string): Promise<{ id: number; name: string }> {
    const found = await this.getUnits(name, 1);
    const match = found.results[0];
    if (match !== undefined) return { id: match.id, name: match.name };
    const created = await this.createUnit(name);
    return { id: created.id, name: created.name };
}

async createRecipe(payload: CreateRecipeRequest): Promise<Recipe> {
    return this.#http.post('/api/recipe/', payload);
}
```

Add `CreateRecipeRequest` to the type import at the top of `tandoorClient.ts`.

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/tandoorClient.test.ts` — expected PASS.

- [ ] **Step 5: Write the failing parser and tool tests**

```ts
// test/createRecipe.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { parseIngredientLine, registerCreateRecipe } from '../src/tools/createRecipe.ts';
import type { WriteContext } from '../src/tools/write.ts';
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

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('create_recipe tool', () => {
    it('previews without creating anything', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerCreateRecipe(server, client, buildContext({ safe_write: true }));
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'create_recipe', arguments: { name: 'Pasta', ingredients_block: '200 g pasta', instructions_block: 'Boil it.' } } },
            z.any()
        )) as { structuredContent: { applied: boolean; confirm_token: string; summary: string } };
        expect(result.structuredContent.applied).toBe(false);
        expect(result.structuredContent.summary).toContain('Pasta');
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

        const preview = (await server.server.request(
            { method: 'tools/call', params: { name: 'create_recipe', arguments: { name: 'Pasta', ingredients_block: '200 g pasta', instructions_block: 'Boil it.' } } },
            z.any()
        )) as { structuredContent: { confirm_token: string } };

        const result = (await server.server.request(
            {
                method: 'tools/call',
                params: { name: 'create_recipe', arguments: { name: 'Pasta', ingredients_block: '200 g pasta', instructions_block: 'Boil it.', confirm: preview.structuredContent.confirm_token } }
            },
            z.any()
        )) as { structuredContent: { applied: boolean; result: { id: number } } };

        expect(result.structuredContent.applied).toBe(true);
        expect(result.structuredContent.result.id).toBe(10);
    });
});
```

- [ ] **Step 6: Run, verify failure** — `npx vitest run test/createRecipe.test.ts` — expected FAIL.

- [ ] **Step 7: Write src/tools/createRecipe.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import type { CreateStepIngredientRequest } from '../client/types.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

const AMOUNT = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/;
const NOTE = /^(.*?)\s*\(([^)]+)\)\s*$/;

/**
 * ponytail: a fixed-shape "[amount] [unit] food [(note)]" parser, not a
 * natural-language ingredient parser. Good enough for straightforward
 * ingredient lists; upgrade to Tandoor's own ingredient-parsing endpoint if
 * one is confirmed to exist (see Task 28) and free-text amounts prove common.
 */
export function parseIngredientLine(line: string): { amount: string; unit?: string; food: string; note?: string } {
    const trimmed = line.trim();
    const noteMatch = NOTE.exec(trimmed);
    const withoutNote = noteMatch ? (noteMatch[1] as string).trim() : trimmed;
    const note = noteMatch ? (noteMatch[2] as string).trim() : undefined;

    const amountMatch = AMOUNT.exec(withoutNote);
    if (!amountMatch) return note === undefined ? { amount: '1', food: withoutNote } : { amount: '1', food: withoutNote, note };

    const amount = amountMatch[1] as string;
    const rest = (amountMatch[2] as string).trim();
    const words = rest.split(/\s+/);
    if (words.length >= 2) {
        const result = { amount, unit: words[0] as string, food: words.slice(1).join(' ') };
        return note === undefined ? result : { ...result, note };
    }
    return note === undefined ? { amount, food: rest } : { amount, food: rest, note };
}

export function registerCreateRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'create_recipe',
        title: 'Create a recipe',
        description:
            'Creates a new Tandoor recipe from a plain ingredients block (one ingredient per line, e.g. "2 cups flour" or "1/2 tsp salt (fine)") and an instructions block. Resolves each ingredient\'s food and unit by searching Tandoor first and creating them only if nothing matches. Previews by default — call again with the returned `confirm` token to actually create it.',
        inputSchema: z.object({
            name: z.string().min(1).describe('Recipe name.'),
            description: z.string().optional().describe('Optional short description.'),
            servings: z.number().positive().optional().describe('Number of servings this recipe produces.'),
            prep_time_minutes: z.number().int().nonnegative().optional().describe('Active prep/cook time in minutes.'),
            cook_time_minutes: z.number().int().nonnegative().optional().describe('Passive waiting time in minutes.'),
            keywords: z.array(z.string()).optional().describe('Keyword/tag names to attach.'),
            ingredients_block: z.string().min(1).describe('One ingredient per line.'),
            instructions_block: z.string().min(1).describe('Free-text cooking instructions, one step.')
        }),
        operation: 'create_recipe',
        tier: 'safe',

        async plan({ name, description, servings, prep_time_minutes, cook_time_minutes, keywords, ingredients_block, instructions_block }): Promise<WritePlan> {
            const lines = ingredients_block
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 0);

            const ingredients: CreateStepIngredientRequest[] = [];
            for (const [index, line] of lines.entries()) {
                const parsed = parseIngredientLine(line);
                const food = await client.resolveFoodId(parsed.food);
                const unit = parsed.unit !== undefined ? await client.resolveUnitId(parsed.unit) : null;
                ingredients.push({ food, unit, amount: parsed.amount, note: parsed.note, order: index, is_header: false, no_amount: false });
            }

            const request = {
                name,
                description: description ?? '',
                servings,
                working_time: prep_time_minutes ?? 0,
                waiting_time: cook_time_minutes ?? 0,
                keywords: (keywords ?? []).map(k => ({ name: k })),
                steps: [{ instruction: instructions_block, order: 1, ingredients }]
            };

            return {
                target: name,
                summary: `Create recipe "${name}" with ${ingredients.length} ingredient(s).`,
                effects: [`Resolves or creates ${ingredients.length} food/unit entr${ingredients.length === 1 ? 'y' : 'ies'} in Tandoor.`, `Adds a new recipe named "${name}".`],
                args: { request }
            };
        },

        async apply(plan) {
            const { request } = plan.args as { request: Parameters<TandoorClient['createRecipe']>[0] };
            return client.createRecipe(request);
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/createRecipe.test.ts` — expected PASS, all eight cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts src/client/types.ts test/tandoorClient.test.ts src/tools/createRecipe.ts test/createRecipe.test.ts
git commit -m "Add create_recipe with ingredient-line parsing and food/unit resolution"
```

---

### Task 16: plan_meals

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `createMealPlan`)
- Create: `src/tools/planMeals.ts`
- Test: `test/tandoorClient.test.ts`, `test/planMeals.test.ts`

**Interfaces:** `TandoorClient.createMealPlan(payload: CreateMealPlanRequest): Promise<MealPlan>`; `function registerPlanMeals(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Confirmed shape:** `POST /api/meal-plan/ {recipe, title, servings, date, meal_type, note} -> MealPlan`.

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.createMealPlan', () => {
    it('posts to /api/meal-plan/', async () => {
        const fetchImpl = serving({ '/api/meal-plan/': { id: 1, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const plan = await client.createMealPlan({ recipe: 1, title: null, servings: 2, date: '2026-01-01', meal_type: 1, note: null });
        expect(plan.id).toBe(1);
    });
});
```

- [ ] **Step 2: Run, verify failure** — expected FAIL.

- [ ] **Step 3: Add the type and method**

```ts
// append to src/client/types.ts
export type CreateMealPlanRequest = { recipe: number | null; title: string | null; servings: number; date: string; meal_type: number; note: string | null };
```

```ts
// append inside the TandoorClient class, add `CreateMealPlanRequest` to the type import
async createMealPlan(payload: CreateMealPlanRequest): Promise<MealPlan> {
    return this.#http.post('/api/meal-plan/', payload);
}
```

- [ ] **Step 4: Run, verify pass** — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/planMeals.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerPlanMeals } from '../src/tools/planMeals.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('plan_meals tool', () => {
    it('resolves recipe name and meal type, then creates one entry per date once confirmed', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=Pasta&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Pasta', keywords: [] }] },
            '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'Dinner', order: 1 }] },
            '/api/meal-plan/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 2, name: 'Dinner', order: 1 } }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerPlanMeals(server, client, buildContext());

        const args = { recipe: 'Pasta', meal_type: 'Dinner', dates: ['2026-01-01'] };
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'plan_meals', arguments: args } }, z.any())) as { structuredContent: { confirm_token: string } };
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'plan_meals', arguments: { ...args, confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean; result: { created: number[] } } };

        expect(result.structuredContent.applied).toBe(true);
        expect(result.structuredContent.result.created).toEqual([5]);
    });

    it('fails the plan when the meal type name does not match any configured meal type', async () => {
        const fetchImpl = serving({
            '/api/recipe/?query=Pasta&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'Pasta', keywords: [] }] },
            '/api/meal-type/': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'Dinner', order: 1 }] }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerPlanMeals(server, client, buildContext());
        await expect(
            server.server.request({ method: 'tools/call', params: { name: 'plan_meals', arguments: { recipe: 'Pasta', meal_type: 'Brunch', dates: ['2026-01-01'] } } }, z.any())
        ).rejects.toThrow(/meal type/i);
    });
});
```

- [ ] **Step 6: Run, verify failure** — expected FAIL.

- [ ] **Step 7: Write src/tools/planMeals.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { ServiceError } from '../core/errors.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

async function resolveRecipeId(client: TandoorClient, recipe: string): Promise<{ id: number; name: string }> {
    if (/^\d+$/.test(recipe)) {
        const found = await client.getRecipe(Number(recipe));
        return { id: found.id, name: found.name };
    }
    const found = await client.searchRecipes({ query: recipe, limit: 1 });
    const match = found.results[0];
    if (match === undefined) {
        throw new ServiceError('NotFound', `no recipe matching "${recipe}"`, { remedy: 'Use search_recipes to find the exact name or id first.' });
    }
    return { id: match.id, name: match.name };
}

async function resolveMealTypeId(client: TandoorClient, mealType: string): Promise<{ id: number; name: string }> {
    const types = await client.getMealTypes();
    const match = types.results.find(t => t.name.toLowerCase() === mealType.toLowerCase());
    if (match === undefined) {
        const available = types.results.map(t => t.name).join(', ');
        throw new ServiceError('NotFound', `no meal type named "${mealType}"`, { remedy: `Available meal types: ${available || '(none configured)'}.` });
    }
    return { id: match.id, name: match.name };
}

export function registerPlanMeals(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'plan_meals',
        title: 'Plan meals',
        description: 'Adds a recipe to the meal plan for one or more dates and a meal type. `recipe` may be a recipe id or a name (resolved via search — take the id from search_recipes first if there is any ambiguity). Previews by default.',
        inputSchema: z.object({
            recipe: z.string().min(1).describe('Recipe id or name.'),
            meal_type: z.string().min(1).describe('Meal type name, e.g. "Dinner" — must match an existing meal type from list_reference_data.'),
            dates: z.array(DateSchema).min(1).describe('One or more dates, YYYY-MM-DD.'),
            servings: z.number().positive().default(1).describe('Servings for each entry.'),
            title: z.string().optional().describe('Optional title override for each entry.'),
            note: z.string().optional().describe('Optional note for each entry.')
        }),
        operation: 'plan_meals',
        tier: 'safe',

        async plan({ recipe, meal_type, dates, servings, title, note }): Promise<WritePlan> {
            const resolvedRecipe = await resolveRecipeId(client, recipe);
            const resolvedMealType = await resolveMealTypeId(client, meal_type);

            return {
                target: `${resolvedRecipe.id}:${resolvedMealType.id}:${dates.join(',')}`,
                summary: `Add "${resolvedRecipe.name}" to the meal plan as ${resolvedMealType.name} on ${dates.length === 1 ? dates[0] : `${dates.length} dates`}.`,
                effects: dates.map(date => `Creates a ${resolvedMealType.name} entry on ${date} for ${resolvedRecipe.name}.`),
                args: { recipeId: resolvedRecipe.id, mealTypeId: resolvedMealType.id, dates, servings, title: title ?? null, note: note ?? null }
            };
        },

        async apply(plan) {
            const { recipeId, mealTypeId, dates, servings, title, note } = plan.args as {
                recipeId: number;
                mealTypeId: number;
                dates: string[];
                servings: number;
                title: string | null;
                note: string | null;
            };
            const created: number[] = [];
            for (const date of dates) {
                const entry = await client.createMealPlan({ recipe: recipeId, title, servings, date, meal_type: mealTypeId, note });
                created.push(entry.id);
            }
            return { created };
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/planMeals.test.ts` — expected PASS, both cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts src/client/types.ts test/tandoorClient.test.ts src/tools/planMeals.ts test/planMeals.test.ts
git commit -m "Add plan_meals"
```

---

### Task 17: update_shopping_list (add / check / uncheck / remove)

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `addShoppingListEntry`, `updateShoppingListEntry`, `deleteShoppingListEntry`)
- Create: `src/tools/updateShoppingList.ts`
- Test: `test/tandoorClient.test.ts`, `test/updateShoppingList.test.ts`

**Interfaces:** `TandoorClient.addShoppingListEntry(payload: { food: {id,name}; unit: {id,name} | null; amount: number }): Promise<ShoppingListEntry>`; `TandoorClient.updateShoppingListEntry(id: number, payload: { checked?: boolean }): Promise<ShoppingListEntry>`; `TandoorClient.deleteShoppingListEntry(id: number): Promise<void>`; `function registerUpdateShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Confirmed shapes:** `POST /api/shopping-list-entry/ {food:{id,name}, unit:{id,name}|null, amount} -> ShoppingListEntry`, `PATCH /api/shopping-list-entry/{id}/ {checked} -> ShoppingListEntry`, `DELETE /api/shopping-list-entry/{id}/`.

`clear_checked` from the design spec is deliberately **not** an action here — its pantry side effect makes it `destructive`, which the write harness ties to the whole tool rather than one action, so it is Task 18's own tool, `clear_shopping_list`.

- [ ] **Step 1: Add the failing client tests**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient shopping list writes', () => {
    it('addShoppingListEntry posts food/unit/amount', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const entry = await client.addShoppingListEntry({ food: { id: 1, name: 'egg' }, unit: null, amount: 6 });
        expect(entry.id).toBe(1);
    });

    it('updateShoppingListEntry patches checked', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/1/': { id: 1, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const entry = await client.updateShoppingListEntry(1, { checked: true });
        expect(entry.checked).toBe(true);
    });

    it('deleteShoppingListEntry deletes and returns nothing', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/1/': null });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.deleteShoppingListEntry(1)).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run, verify failure** — expected FAIL.

- [ ] **Step 3: Add the methods to src/client/tandoorClient.ts**

```ts
// append inside the TandoorClient class
async addShoppingListEntry(payload: { food: { id: number; name: string }; unit: { id: number; name: string } | null; amount: number }): Promise<ShoppingListEntry> {
    return this.#http.post('/api/shopping-list-entry/', payload);
}

async updateShoppingListEntry(id: number, payload: { checked?: boolean }): Promise<ShoppingListEntry> {
    return this.#http.patch(`/api/shopping-list-entry/${id}/`, payload);
}

async deleteShoppingListEntry(id: number): Promise<void> {
    await this.#http.delete(`/api/shopping-list-entry/${id}/`);
}
```

- [ ] **Step 4: Run, verify pass** — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/updateShoppingList.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerUpdateShoppingList } from '../src/tools/updateShoppingList.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

async function confirmAndCall(server: McpServer, args: Record<string, unknown>) {
    const preview = (await server.server.request({ method: 'tools/call', params: { name: 'update_shopping_list', arguments: args } }, z.any())) as {
        structuredContent: { confirm_token: string };
    };
    return server.server.request({ method: 'tools/call', params: { name: 'update_shopping_list', arguments: { ...args, confirm: preview.structuredContent.confirm_token } } }, z.any()) as Promise<{
        structuredContent: { applied: boolean };
    }>;
}

describe('update_shopping_list tool', () => {
    it('adds an item, resolving the food and unit', async () => {
        const fetchImpl = serving({
            '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] },
            '/api/shopping-list-entry/': { id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        const result = await confirmAndCall(server, { action: 'add', food: 'egg', amount: 6 });
        expect(result.structuredContent.applied).toBe(true);
    });

    it('checks an existing item by id, reading its name first for the preview', async () => {
        const fetchImpl = serving({
            '/api/shopping-list-entry/': { count: 1, next: null, previous: null, results: [{ id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: false }] },
            '/api/shopping-list-entry/9/': { id: 9, food: { id: 1, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        const result = await confirmAndCall(server, { action: 'check', item_id: 9 });
        expect(result.structuredContent.applied).toBe(true);
    });

    it('rejects action "add" without a food argument', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdateShoppingList(server, client, buildContext());
        await expect(server.server.request({ method: 'tools/call', params: { name: 'update_shopping_list', arguments: { action: 'add', amount: 1 } } }, z.any())).rejects.toThrow(/food/i);
    });
});
```

- [ ] **Step 6: Run, verify failure** — expected FAIL.

- [ ] **Step 7: Write src/tools/updateShoppingList.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { ServiceError } from '../core/errors.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

type Args = { action: 'add' | 'check' | 'uncheck' | 'remove'; food?: string; amount?: number; unit?: string; item_id?: number };

async function findEntry(client: TandoorClient, itemId: number) {
    const list = await client.getShoppingList();
    const entry = list.results.find(e => e.id === itemId);
    if (entry === undefined) {
        throw new ServiceError('NotFound', `no shopping list item with id ${itemId}`, { remedy: 'Use get_shopping_list to find the current item ids.' });
    }
    return entry;
}

export function registerUpdateShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'update_shopping_list',
        title: 'Update shopping list',
        description:
            'Adds, checks, unchecks, or removes a shopping list item. `add` takes `food` (and optionally `amount`/`unit`); `check`/`uncheck`/`remove` take `item_id` from get_shopping_list. To clear every checked item and mark those foods on-hand, use clear_shopping_list instead — that action is destructive.',
        inputSchema: z.object({
            action: z.enum(['add', 'check', 'uncheck', 'remove']),
            food: z.string().optional().describe('Required for action "add": the food name.'),
            amount: z.number().positive().default(1).describe('Amount, for action "add".'),
            unit: z.string().optional().describe('Optional unit name, for action "add".'),
            item_id: z.number().int().positive().optional().describe('Required for check/uncheck/remove: the shopping list entry id.')
        }),
        operation: 'update_shopping_list',
        tier: 'safe',

        async plan({ action, food, amount, unit, item_id }): Promise<WritePlan> {
            if (action === 'add') {
                if (food === undefined) throw new Error('action "add" requires `food`.');
                const resolvedFood = await client.resolveFoodId(food);
                const resolvedUnit = unit !== undefined ? await client.resolveUnitId(unit) : null;
                return {
                    target: resolvedFood.name,
                    summary: `Add ${amount}${resolvedUnit ? ` ${resolvedUnit.name}` : ''} ${resolvedFood.name} to the shopping list.`,
                    effects: ['Creates a new shopping list entry.'],
                    args: { action, foodId: resolvedFood.id, foodName: resolvedFood.name, unitId: resolvedUnit?.id ?? null, unitName: resolvedUnit?.name ?? null, amount }
                };
            }

            if (item_id === undefined) throw new Error(`action "${action}" requires \`item_id\`.`);
            const entry = await findEntry(client, item_id);
            const verb = action === 'check' ? 'Check off' : action === 'uncheck' ? 'Uncheck' : 'Remove';
            return {
                target: String(item_id),
                summary: `${verb} "${entry.food.name}" on the shopping list.`,
                effects: [action === 'remove' ? 'Deletes the entry permanently.' : 'Updates the entry\'s checked state.'],
                args: { action, itemId: item_id }
            };
        },

        async apply(plan) {
            const args = plan.args as { action: Args['action']; foodId?: number; foodName?: string; unitId?: number | null; unitName?: string | null; amount?: number; itemId?: number };
            if (args.action === 'add') {
                return client.addShoppingListEntry({
                    food: { id: args.foodId as number, name: args.foodName as string },
                    unit: args.unitId != null ? { id: args.unitId, name: args.unitName as string } : null,
                    amount: args.amount as number
                });
            }
            const itemId = args.itemId as number;
            if (args.action === 'check') return client.updateShoppingListEntry(itemId, { checked: true });
            if (args.action === 'uncheck') return client.updateShoppingListEntry(itemId, { checked: false });
            await client.deleteShoppingListEntry(itemId);
            return { deleted: itemId };
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/updateShoppingList.test.ts` — expected PASS, all three cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/updateShoppingList.ts test/updateShoppingList.test.ts
git commit -m "Add update_shopping_list: add/check/uncheck/remove"
```

---

### Task 18: clear_shopping_list (destructive — clears checked items, updates pantry)

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `updateFoodOnHand`)
- Create: `src/tools/clearShoppingList.ts`
- Test: `test/tandoorClient.test.ts`, `test/clearShoppingList.test.ts`

**Interfaces:** `TandoorClient.updateFoodOnHand(id: number, onHand: boolean): Promise<Food>`; `function registerClearShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Confirmed shape:** `PATCH /api/food/{id}/ {food_onhand} -> Food`.

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.updateFoodOnHand', () => {
    it('patches food_onhand', async () => {
        const fetchImpl = serving({ '/api/food/1/': { id: 1, name: 'egg', food_onhand: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const food = await client.updateFoodOnHand(1, true);
        expect(food.food_onhand).toBe(true);
    });
});
```

- [ ] **Step 2: Run, verify failure** — expected FAIL.

- [ ] **Step 3: Add the method**

```ts
// append inside the TandoorClient class
async updateFoodOnHand(id: number, onHand: boolean): Promise<Food> {
    return this.#http.patch(`/api/food/${id}/`, { food_onhand: onHand });
}
```

- [ ] **Step 4: Run, verify pass** — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/clearShoppingList.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerClearShoppingList } from '../src/tools/clearShoppingList.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

const LIST = {
    count: 2, next: null, previous: null,
    results: [
        { id: 1, food: { id: 10, name: 'egg', food_onhand: false }, unit: null, amount: 6, checked: true },
        { id: 2, food: { id: 20, name: 'milk', food_onhand: false }, unit: null, amount: 1, checked: false }
    ]
};

describe('clear_shopping_list tool', () => {
    it('requires the destructive tier, not just safe_write', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': LIST }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ safe_write: true, destructive: false }));
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'clear_shopping_list', arguments: {} } }, z.any())) as { structuredContent: { confirm_token: string } };
        await expect(
            server.server.request({ method: 'tools/call', params: { name: 'clear_shopping_list', arguments: { confirm: preview.structuredContent.confirm_token } } }, z.any())
        ).rejects.toThrow(/permission denied/i);
    });

    it('deletes checked items and marks their foods on-hand once confirmed with destructive permission', async () => {
        const fetchImpl = serving({ '/api/shopping-list-entry/': LIST, '/api/shopping-list-entry/1/': null, '/api/food/10/': { id: 10, name: 'egg', food_onhand: true } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ destructive: true }));
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'clear_shopping_list', arguments: {} } }, z.any())) as { structuredContent: { confirm_token: string } };
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'clear_shopping_list', arguments: { confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean; result: { removed: number[] } } };
        expect(result.structuredContent.applied).toBe(true);
        expect(result.structuredContent.result.removed).toEqual([1]);
    });

    it('is a no-op when nothing is checked', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/shopping-list-entry/': { count: 0, next: null, previous: null, results: [] } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerClearShoppingList(server, client, buildContext({ destructive: true }));
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'clear_shopping_list', arguments: {} } }, z.any())) as { structuredContent: { noop: boolean; confirm_token?: string } };
        expect(result.structuredContent.noop).toBe(true);
        expect(result.structuredContent.confirm_token).toBeUndefined();
    });
});
```

- [ ] **Step 6: Run, verify failure** — expected FAIL.

- [ ] **Step 7: Write src/tools/clearShoppingList.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerClearShoppingList(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'clear_shopping_list',
        title: 'Clear checked shopping list items',
        description:
            'Removes every checked item from the shopping list and marks the corresponding foods on-hand in the pantry. Destructive — the removed entries cannot be recovered — so it needs the `destructive` permission tier, not just `safe_write`. Previews by default.',
        inputSchema: z.object({}),
        operation: 'clear_shopping_list',
        tier: 'destructive',

        async plan(): Promise<WritePlan> {
            const list = await client.getShoppingList();
            const checked = list.results.filter(e => e.checked);
            if (checked.length === 0) {
                return { target: 'shopping-list', summary: 'No checked items to clear.', effects: [], noop: true };
            }
            return {
                target: `checked:${checked.map(e => e.id).join(',')}`,
                summary: `Clear ${checked.length} checked item(s) from the shopping list and mark those foods on-hand.`,
                effects: checked.map(e => `Deletes "${e.food.name}" and marks it on-hand in the pantry.`),
                args: { entries: checked.map(e => ({ id: e.id, foodId: e.food.id })) }
            };
        },

        async apply(plan) {
            const { entries } = plan.args as { entries: { id: number; foodId: number }[] };
            const removed: number[] = [];
            for (const entry of entries) {
                await client.deleteShoppingListEntry(entry.id);
                await client.updateFoodOnHand(entry.foodId, true);
                removed.push(entry.id);
            }
            return { removed };
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/clearShoppingList.test.ts` — expected PASS, all three cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/clearShoppingList.ts test/clearShoppingList.test.ts
git commit -m "Add clear_shopping_list as a destructive-tier tool"
```

---

### Task 19: update_pantry

**Files:**
- Create: `src/tools/updatePantry.ts`
- Test: `test/updatePantry.test.ts`

**Interfaces:** Consumes `TandoorClient.resolveFoodId` and `updateFoodOnHand` (already added, Tasks 15/18). Produces `function registerUpdatePantry(server: McpServer, client: TandoorClient, context: WriteContext): void`.

- [ ] **Step 1: Write the failing tool test**

```ts
// test/updatePantry.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerUpdatePantry } from '../src/tools/updatePantry.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('update_pantry tool', () => {
    it('resolves each food and updates its on-hand flag once confirmed', async () => {
        const fetchImpl = serving({
            '/api/food/?query=egg&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: false }] },
            '/api/food/?query=flour&page_size=1': { count: 1, next: null, previous: null, results: [{ id: 2, name: 'flour', food_onhand: true }] },
            '/api/food/1/': { id: 1, name: 'egg', food_onhand: true },
            '/api/food/2/': { id: 2, name: 'flour', food_onhand: false }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerUpdatePantry(server, client, buildContext());

        const args = { items: [{ food: 'egg', available: true }, { food: 'flour', available: false }] };
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'update_pantry', arguments: args } }, z.any())) as { structuredContent: { confirm_token: string } };
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'update_pantry', arguments: { ...args, confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean; result: { updated: number[] } } };
        expect(result.structuredContent.applied).toBe(true);
        expect(result.structuredContent.result.updated).toEqual([1, 2]);
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/updatePantry.test.ts` — expected FAIL.

- [ ] **Step 3: Write src/tools/updatePantry.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerUpdatePantry(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'update_pantry',
        title: 'Update pantry',
        description: 'Batch-marks foods as on-hand or not on-hand, resolving each food name by search-or-create. Previews by default.',
        inputSchema: z.object({
            items: z.array(z.object({ food: z.string().min(1), available: z.boolean() })).min(1).describe('Foods to update.')
        }),
        operation: 'update_pantry',
        tier: 'safe',

        async plan({ items }): Promise<WritePlan> {
            const resolved: { id: number; name: string; available: boolean }[] = [];
            for (const item of items) {
                const food = await client.resolveFoodId(item.food);
                resolved.push({ ...food, available: item.available });
            }
            return {
                target: resolved.map(r => r.id).join(','),
                summary: `Update pantry availability for ${resolved.length} food(s).`,
                effects: resolved.map(r => `Mark "${r.name}" as ${r.available ? 'on-hand' : 'not on-hand'}.`),
                args: { items: resolved }
            };
        },

        async apply(plan) {
            const { items } = plan.args as { items: { id: number; available: boolean }[] };
            const updated: number[] = [];
            for (const item of items) {
                await client.updateFoodOnHand(item.id, item.available);
                updated.push(item.id);
            }
            return { updated };
        }
    });
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/updatePantry.test.ts` — expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/updatePantry.ts test/updatePantry.test.ts
git commit -m "Add update_pantry"
```

---

### Task 20: log_cooked_recipe

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `createCookLog`)
- Create: `src/tools/logCookedRecipe.ts`
- Test: `test/tandoorClient.test.ts`, `test/logCookedRecipe.test.ts`

**Interfaces:** `TandoorClient.createCookLog(payload: { recipe: number; servings: number; rating?: number; comment?: string }): Promise<CookLog>`; `function registerLogCookedRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Confirmed shape:** `POST /api/cook-log/ {recipe, servings, rating, comment} -> CookLog`.

- [ ] **Step 1: Add the failing client test**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient.createCookLog', () => {
    it('posts to /api/cook-log/', async () => {
        const fetchImpl = serving({ '/api/cook-log/': { id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: 'great', created: '2026-01-01T00:00:00Z' } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const log = await client.createCookLog({ recipe: 1, servings: 2, rating: 5, comment: 'great' });
        expect(log.id).toBe(1);
    });
});
```

- [ ] **Step 2: Run, verify failure** — expected FAIL.

- [ ] **Step 3: Add the method**

```ts
// append inside the TandoorClient class
async createCookLog(payload: { recipe: number; servings: number; rating?: number; comment?: string }): Promise<CookLog> {
    return this.#http.post('/api/cook-log/', payload);
}
```

- [ ] **Step 4: Run, verify pass** — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/logCookedRecipe.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerLogCookedRecipe } from '../src/tools/logCookedRecipe.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(): WriteContext {
    return { permissions: { safe_write: true, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('log_cooked_recipe tool', () => {
    it('reads the recipe name for the preview, then logs it once confirmed', async () => {
        const fetchImpl = serving({
            '/api/recipe/1/': { id: 1, name: 'Pasta', keywords: [], steps: [] },
            '/api/cook-log/': { id: 1, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, rating: 5, comment: null, created: '2026-01-01T00:00:00Z' }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerLogCookedRecipe(server, client, buildContext());

        const args = { recipe_id: 1, servings: 2, rating: 5 };
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'log_cooked_recipe', arguments: args } }, z.any())) as { structuredContent: { summary: string; confirm_token: string } };
        expect(preview.structuredContent.summary).toContain('Pasta');

        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'log_cooked_recipe', arguments: { ...args, confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean; result: { id: number } } };
        expect(result.structuredContent.applied).toBe(true);
        expect(result.structuredContent.result.id).toBe(1);
    });
});
```

- [ ] **Step 6: Run, verify failure** — expected FAIL.

- [ ] **Step 7: Write src/tools/logCookedRecipe.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerLogCookedRecipe(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'log_cooked_recipe',
        title: 'Log a cooked recipe',
        description: 'Records that a recipe was cooked: servings made, an optional rating (1-5), and an optional comment. Previews by default.',
        inputSchema: z.object({
            recipe_id: z.number().int().positive(),
            servings: z.number().positive().default(1),
            rating: z.number().int().min(1).max(5).optional(),
            comment: z.string().optional()
        }),
        operation: 'log_cooked_recipe',
        tier: 'safe',

        async plan({ recipe_id, servings, rating, comment }): Promise<WritePlan> {
            const recipe = await client.getRecipe(recipe_id);
            return {
                target: String(recipe_id),
                summary: `Log that "${recipe.name}" was cooked (${servings} serving(s)${rating !== undefined ? `, rated ${rating}/5` : ''}).`,
                effects: ['Adds one entry to the cook log.'],
                args: { recipe: recipe_id, servings, rating, comment }
            };
        },

        async apply(plan) {
            const { recipe, servings, rating, comment } = plan.args as { recipe: number; servings: number; rating?: number; comment?: string };
            return client.createCookLog({ recipe, servings, rating, comment });
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/logCookedRecipe.test.ts` — expected PASS.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/logCookedRecipe.ts test/logCookedRecipe.test.ts
git commit -m "Add log_cooked_recipe"
```

---

### Task 21: delete_meal_plan

**Files:**
- Modify: `src/client/tandoorClient.ts` (add `getMealPlan`, `deleteMealPlan`)
- Create: `src/tools/deleteMealPlan.ts`
- Test: `test/tandoorClient.test.ts`, `test/deleteMealPlan.test.ts`

**Interfaces:** `TandoorClient.getMealPlan(id: number): Promise<MealPlan>`; `TandoorClient.deleteMealPlan(id: number): Promise<void>`; `function registerDeleteMealPlan(server: McpServer, client: TandoorClient, context: WriteContext): void`

**Shapes:** `DELETE /api/meal-plan/{id}/` is confirmed (Task 12's sibling `POST`/list endpoints and the reference implementation both use it). `GET /api/meal-plan/{id}/` is inferred from Tandoor's uniform DRF-ViewSet convention (every other resource in this plan has a matching single-item GET) but not directly observed in either reference implementation — verify it during Task 28's fixture capture; if it 404s, fall back to filtering `getMealPlans` by a wide date range and matching `id` client-side, and note the fallback in a comment where `getMealPlan` is defined.

- [ ] **Step 1: Add the failing client tests**

```ts
// append to test/tandoorClient.test.ts
describe('TandoorClient meal plan single-item operations', () => {
    it('getMealPlan fetches one entry by id', async () => {
        const fetchImpl = serving({ '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.getMealPlan(5)).resolves.toMatchObject({ id: 5 });
    });

    it('deleteMealPlan deletes by id', async () => {
        const fetchImpl = serving({ '/api/meal-plan/5/': null });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        await expect(client.deleteMealPlan(5)).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2: Run, verify failure** — expected FAIL.

- [ ] **Step 3: Add the methods**

```ts
// append inside the TandoorClient class
async getMealPlan(id: number): Promise<MealPlan> {
    return this.#http.get(`/api/meal-plan/${id}/`);
}

async deleteMealPlan(id: number): Promise<void> {
    await this.#http.delete(`/api/meal-plan/${id}/`);
}
```

- [ ] **Step 4: Run, verify pass** — expected PASS.

- [ ] **Step 5: Write the failing tool test**

```ts
// test/deleteMealPlan.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerDeleteMealPlan } from '../src/tools/deleteMealPlan.ts';
import type { WriteContext } from '../src/tools/write.ts';
import { serving } from './helpers/serve.ts';

function buildContext(overrides: Partial<WriteContext['permissions']> = {}): WriteContext {
    return { permissions: { safe_write: false, destructive: false, ...overrides }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() };
}

describe('delete_meal_plan tool', () => {
    it('requires the destructive tier', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({ '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } } }));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerDeleteMealPlan(server, client, buildContext({ safe_write: true }));
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'delete_meal_plan', arguments: { id: 5 } } }, z.any())) as { structuredContent: { confirm_token: string } };
        await expect(
            server.server.request({ method: 'tools/call', params: { name: 'delete_meal_plan', arguments: { id: 5, confirm: preview.structuredContent.confirm_token } } }, z.any())
        ).rejects.toThrow(/permission denied/i);
    });

    it('deletes once confirmed with destructive permission', async () => {
        const fetchImpl = serving({
            '/api/meal-plan/5/': { id: 5, title: null, recipe: { id: 1, name: 'Pasta', keywords: [] }, servings: 2, note: null, date: '2026-01-01', meal_type: { id: 1, name: 'Dinner', order: 1 } }
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerDeleteMealPlan(server, client, buildContext({ destructive: true }));
        const preview = (await server.server.request({ method: 'tools/call', params: { name: 'delete_meal_plan', arguments: { id: 5 } } }, z.any())) as { structuredContent: { confirm_token: string; summary: string } };
        expect(preview.structuredContent.summary).toContain('Pasta');
        const result = (await server.server.request(
            { method: 'tools/call', params: { name: 'delete_meal_plan', arguments: { id: 5, confirm: preview.structuredContent.confirm_token } } },
            z.any()
        )) as { structuredContent: { applied: boolean } };
        expect(result.structuredContent.applied).toBe(true);
    });
});
```

- [ ] **Step 6: Run, verify failure** — expected FAIL.

- [ ] **Step 7: Write src/tools/deleteMealPlan.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { registerWriteTool, type WriteContext, type WritePlan } from './write.ts';

export function registerDeleteMealPlan(server: McpServer, client: TandoorClient, context: WriteContext): void {
    registerWriteTool(server, context, {
        name: 'delete_meal_plan',
        title: 'Delete a meal plan entry',
        description: 'Deletes one meal plan entry by id, from get_meal_plan. Cannot be undone. Previews by default.',
        inputSchema: z.object({ id: z.number().int().positive() }),
        operation: 'delete_meal_plan',
        tier: 'destructive',

        async plan({ id }): Promise<WritePlan> {
            const entry = await client.getMealPlan(id);
            const label = entry.recipe?.name ?? entry.title ?? '(untitled)';
            return {
                target: String(id),
                summary: `Delete the ${entry.meal_type.name} meal plan entry for "${label}" on ${entry.date}.`,
                effects: ['Cannot be undone.'],
                args: { id }
            };
        },

        async apply(plan) {
            const { id } = plan.args as { id: number };
            await client.deleteMealPlan(id);
            return { deleted: id };
        }
    });
}
```

- [ ] **Step 8: Run, verify pass** — `npx vitest run test/deleteMealPlan.test.ts` — expected PASS, both cases.

- [ ] **Step 9: Commit**

```bash
git add src/client/tandoorClient.ts test/tandoorClient.test.ts src/tools/deleteMealPlan.ts test/deleteMealPlan.test.ts
git commit -m "Add delete_meal_plan"
```

---

### Task 22: suggest_recipes

The deepest tool in the set: no Tandoor endpoint does this. Cross-references on-hand foods against every candidate recipe's ingredients and ranks by match percentage. Read-only (no write-safety machinery), but does real work: `ponytail: sequential per-recipe detail fetch (N calls to get_recipe for N candidate recipes) rather than a batched endpoint Tandoor doesn't offer — fine for a typical home-cook-sized recipe library; add caching or parallelize if a very large library makes this slow.`

**Files:**
- Create: `src/tools/suggestRecipes.ts`
- Test: `test/suggestRecipes.test.ts`

**Interfaces:** Consumes `TandoorClient.searchFoods`, `searchRecipes`, `getRecipe` (all already added). Produces `function registerSuggestRecipes(server: McpServer, client: TandoorClient): void`.

- [ ] **Step 1: Write the failing test**

```ts
// test/suggestRecipes.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { registerSuggestRecipes } from '../src/tools/suggestRecipes.ts';
import { serving } from './helpers/serve.ts';

const PANTRY = { count: 2, next: null, previous: null, results: [{ id: 1, name: 'egg', food_onhand: true }, { id: 2, name: 'flour', food_onhand: true }] };

const CANDIDATES = { count: 2, next: null, previous: null, results: [{ id: 10, name: 'Pancakes', keywords: [] }, { id: 20, name: 'Sushi', keywords: [] }] };

const PANCAKES = {
    id: 10, name: 'Pancakes', keywords: [], servings: 4,
    steps: [{ id: 1, name: '', order: 1, instruction: 'Mix and cook.', ingredients: [
        { id: 1, food: { id: 1, name: 'egg', food_onhand: true }, unit: null, amount: 2, is_header: false, no_amount: false },
        { id: 2, food: { id: 2, name: 'flour', food_onhand: true }, unit: null, amount: 200, is_header: false, no_amount: false }
    ] }]
};

const SUSHI = {
    id: 20, name: 'Sushi', keywords: [], servings: 2,
    steps: [{ id: 1, name: '', order: 1, instruction: 'Roll it.', ingredients: [
        { id: 1, food: { id: 3, name: 'nori', food_onhand: false }, unit: null, amount: 4, is_header: false, no_amount: false },
        { id: 2, food: { id: 4, name: 'rice', food_onhand: false }, unit: null, amount: 300, is_header: false, no_amount: false }
    ] }]
};

describe('suggest_recipes tool', () => {
    it('ranks recipes by how much of the pantry they use', async () => {
        const fetchImpl = serving({
            '/api/food/?query=&page_size=200': PANTRY,
            '/api/recipe/?page_size=100': CANDIDATES,
            '/api/recipe/10/': PANCAKES,
            '/api/recipe/20/': SUSHI
        });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSuggestRecipes(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'suggest_recipes', arguments: {} } }, z.any())) as {
            structuredContent: { suggestions: Array<{ recipe_name: string; match_percentage: number }> };
        };
        expect(result.structuredContent.suggestions[0]?.recipe_name).toBe('Pancakes');
        expect(result.structuredContent.suggestions[0]?.match_percentage).toBe(100);
        expect(result.structuredContent.suggestions.find(s => s.recipe_name === 'Sushi')).toBeUndefined();
    });

    it('reports no suggestions when the pantry is empty', async () => {
        const fetchImpl = serving({ '/api/food/?query=&page_size=200': { count: 0, next: null, previous: null, results: [] } });
        const client = new TandoorClient('https://t.example', 'secret', 5000, fetchImpl);
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerSuggestRecipes(server, client);
        const result = (await server.server.request({ method: 'tools/call', params: { name: 'suggest_recipes', arguments: {} } }, z.any())) as { structuredContent: { suggestions: unknown[] } };
        expect(result.structuredContent.suggestions).toEqual([]);
    });
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/suggestRecipes.test.ts` — expected FAIL.

- [ ] **Step 3: Write src/tools/suggestRecipes.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { TandoorClient } from '../client/tandoorClient.ts';
import { READ_ONLY, toolInput } from '../core/shape.ts';

const MODE = ['maximum-use', 'expiring-soon'] as const;

function shouldInclude(mode: (typeof MODE)[number], matchPercent: number, missingCount: number): boolean {
    if (mode === 'expiring-soon') return matchPercent >= 30 && missingCount <= 3;
    return matchPercent >= 50;
}

export function registerSuggestRecipes(server: McpServer, client: TandoorClient): void {
    server.registerTool(
        'suggest_recipes',
        {
            title: 'Suggest recipes from pantry',
            annotations: READ_ONLY,
            description:
                'Recommends recipes based on which foods are currently marked on-hand, ranked by what percentage of each recipe\'s ingredients you already have. `mode: "maximum-use"` (default) favors a high match; `mode: "expiring-soon"` favors a lower bar with few missing ingredients, for using up what you have soon.',
            inputSchema: toolInput({
                mode: z.enum(MODE).default('maximum-use'),
                limit: z.number().int().positive().max(50).default(10)
            })
        },
        async ({ mode, limit }) => {
            const pantryResponse = await client.searchFoods('', 200);
            const onHand = new Set(pantryResponse.results.filter(f => f.food_onhand).map(f => f.name.toLowerCase()));

            if (onHand.size === 0) {
                const result = { suggestions: [], mode, total_available: 0, message: 'No ingredients marked on-hand. Use update_pantry first.' };
                return { content: [{ type: 'text', text: result.message }], structuredContent: result };
            }

            const candidates = await client.searchRecipes({ limit: 100 });
            const suggestions: { recipe_id: number; recipe_name: string; match_percentage: number; missing_ingredients: string[] }[] = [];

            for (const candidate of candidates.results) {
                const recipe = await client.getRecipe(candidate.id);
                const ingredients = recipe.steps.flatMap(s => s.ingredients).filter(i => !i.is_header && !i.no_amount);
                if (ingredients.length === 0) continue;

                const missing = ingredients.filter(i => !onHand.has(i.food.name.toLowerCase())).map(i => i.food.name);
                const matchPercentage = Math.round(((ingredients.length - missing.length) / ingredients.length) * 100);

                if (shouldInclude(mode, matchPercentage, missing.length)) {
                    suggestions.push({ recipe_id: recipe.id, recipe_name: recipe.name, match_percentage: matchPercentage, missing_ingredients: missing });
                }
            }

            suggestions.sort((a, b) => b.match_percentage - a.match_percentage);
            const top = suggestions.slice(0, limit);

            const result = { suggestions: top, mode, total_available: onHand.size, message: `Found ${top.length} recipe suggestion(s) using your ${onHand.size} on-hand ingredient(s).` };
            return { content: [{ type: 'text', text: result.message }], structuredContent: result };
        }
    );
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/suggestRecipes.test.ts` — expected PASS, both cases.

- [ ] **Step 5: Commit**

```bash
git add src/tools/suggestRecipes.ts test/suggestRecipes.test.ts
git commit -m "Add suggest_recipes: pantry-based recipe ranking"
```

---

### Task 23: Register all tools, server instructions, end-to-end smoke test

**Files:**
- Create: `src/tools/register.ts`
- Modify: `src/index.ts` (wire `registerAllTools` into `buildServer`)
- Test: `test/register.test.ts`

**Interfaces:** `function registerAllTools(server: McpServer, deps: { client: TandoorClient; context: WriteContext }): void`

- [ ] **Step 1: Write the failing test**

```ts
// test/register.test.ts
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/v4';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { WriteAudit } from '../src/core/audit.ts';
import { ConfirmTokens } from '../src/core/confirm.ts';
import { registerAllTools } from '../src/tools/register.ts';
import { serving } from './helpers/serve.ts';

describe('registerAllTools', () => {
    it('registers exactly the 13 designed tools', async () => {
        const client = new TandoorClient('https://t.example', 'secret', 5000, serving({}));
        const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
        registerAllTools(server, { client, context: { permissions: { safe_write: false, destructive: false }, confirm: new ConfirmTokens(), audit: WriteAudit.ephemeral() } });

        const result = (await server.server.request({ method: 'tools/list', params: {} }, z.any())) as { tools: Array<{ name: string }> };
        const names = result.tools.map(t => t.name).sort();
        expect(names).toEqual(
            [
                'clear_shopping_list', 'create_recipe', 'delete_meal_plan', 'get_cook_log', 'get_meal_plan', 'get_recipe',
                'get_shopping_list', 'list_reference_data', 'log_cooked_recipe', 'plan_meals', 'search_recipes',
                'suggest_recipes', 'update_pantry', 'update_shopping_list'
            ].sort()
        );
    });
});
```

Note: that is 14 names, not 13 — the design spec's "12 tools" count from the original brainstorm grew to 14 distinct tool registrations once `update_shopping_list`'s `clear_checked` action was split out into its own `clear_shopping_list` tool (Task 18) to fix a mismatch with the write harness's one-tier-per-tool design (see Task 17's note). Confirm the count matches what Tasks 9-22 actually registered — 6 read tools (search_recipes, get_recipe, list_reference_data, get_meal_plan, get_shopping_list, get_cook_log) + suggest_recipes (read) + 7 write tools (create_recipe, plan_meals, update_shopping_list, clear_shopping_list, update_pantry, log_cooked_recipe, delete_meal_plan) = 14. Fix the array above if it drifts from what was actually built.

- [ ] **Step 2: Run, verify failure** — `npx vitest run test/register.test.ts` — expected FAIL.

- [ ] **Step 3: Write src/tools/register.ts**

```ts
import type { McpServer } from '@modelcontextprotocol/server';
import type { TandoorClient } from '../client/tandoorClient.ts';
import type { WriteContext } from './write.ts';
import { registerClearShoppingList } from './clearShoppingList.ts';
import { registerCreateRecipe } from './createRecipe.ts';
import { registerDeleteMealPlan } from './deleteMealPlan.ts';
import { registerGetCookLog } from './getCookLog.ts';
import { registerGetMealPlan } from './getMealPlan.ts';
import { registerGetRecipe } from './getRecipe.ts';
import { registerGetShoppingList } from './getShoppingList.ts';
import { registerListReferenceData } from './listReferenceData.ts';
import { registerLogCookedRecipe } from './logCookedRecipe.ts';
import { registerPlanMeals } from './planMeals.ts';
import { registerSearchRecipes } from './searchRecipes.ts';
import { registerSuggestRecipes } from './suggestRecipes.ts';
import { registerUpdatePantry } from './updatePantry.ts';
import { registerUpdateShoppingList } from './updateShoppingList.ts';

export function registerAllTools(server: McpServer, deps: { client: TandoorClient; context: WriteContext }): void {
    const { client, context } = deps;
    registerSearchRecipes(server, client);
    registerGetRecipe(server, client);
    registerListReferenceData(server, client);
    registerGetMealPlan(server, client);
    registerGetShoppingList(server, client);
    registerGetCookLog(server, client);
    registerSuggestRecipes(server, client);
    registerCreateRecipe(server, client, context);
    registerPlanMeals(server, client, context);
    registerUpdateShoppingList(server, client, context);
    registerClearShoppingList(server, client, context);
    registerUpdatePantry(server, client, context);
    registerLogCookedRecipe(server, client, context);
    registerDeleteMealPlan(server, client, context);
}
```

- [ ] **Step 4: Run, verify pass** — `npx vitest run test/register.test.ts` — expected PASS.

- [ ] **Step 5: Wire registerAllTools into src/index.ts**

Update the `buildServer` factory (added in Task 8) to build a `TandoorClient` and `WriteContext` from the loaded config and call `registerAllTools`:

```ts
// src/index.ts — replace the buildServer definition and the try block with:
import { McpServer } from '@modelcontextprotocol/server';
import { serve } from '@hono/node-server';
import { bootstrap } from './bootstrap.ts';
import { TandoorClient } from './client/tandoorClient.ts';
import { ConfigInvalidError, loadConfig } from './config/load.ts';
import { ConfirmTokens } from './core/confirm.ts';
import { logger } from './core/logger.ts';
import { registerAllTools } from './tools/register.ts';
import type { WriteAudit } from './core/audit.ts';

const CONFIG_DIR = process.env.TANDOOR_MCP_CONFIG_DIR ?? '/config';
const VERSION = process.env.TANDOOR_MCP_VERSION ?? '0.0.0-dev';

function parseBindAddr(addr: string): { hostname: string; port: number } {
    const match = /^(.*):(\d{1,5})$/.exec(addr);
    if (!match) throw new Error(`invalid bind_addr "${addr}", expected host:port`);
    return { hostname: match[1] as string, port: Number(match[2]) };
}

try {
    const config = loadConfig(CONFIG_DIR);
    const client = new TandoorClient(config.tandoor.url, config.tandoor.token, config.tandoor.timeout_ms);
    const confirm = new ConfirmTokens();

    let audit: WriteAudit;
    const buildServer = () => {
        const server = new McpServer(
            { name: 'tandoor-mcp', version: VERSION },
            { instructions: 'An MCP server for Tandoor Recipes.', capabilities: { tools: { listChanged: false } } }
        );
        registerAllTools(server, { client, context: { permissions: config.permissions, confirm, audit } });
        return server;
    };

    const bootstrapped = await bootstrap(CONFIG_DIR, buildServer);
    audit = bootstrapped.audit;

    const { hostname, port } = parseBindAddr(config.mcp.bind_addr);
    serve({ fetch: bootstrapped.app.fetch, hostname, port }, info => logger.info({ port: info.port }, 'tandoor-mcp listening'));
} catch (err) {
    if (err instanceof ConfigInvalidError) {
        logger.error({ detail: err.detail }, 'config.yaml is invalid — see config.example.yaml for the expected shape');
        process.exit(1);
    }
    throw err;
}
```

This has a real ordering wrinkle worth fixing during implementation rather than shipping as written: `buildServer` closes over `audit` before it is assigned (`bootstrap` opens the audit log and returns it, but `buildServer` is passed into `bootstrap` and could in principle be invoked before `bootstrap` returns). Resolve it by changing `bootstrap`'s signature to open the `WriteAudit` itself and pass it into a `buildServer` factory that takes `audit` as a parameter — i.e. `bootstrap(configDir, (audit) => McpServer)` — rather than relying on closure timing. Update `src/bootstrap.ts` and `test/app.test.ts`'s `buildServer` fixture accordingly, and re-run the full suite after making this change.

- [ ] **Step 6: Manual end-to-end smoke test against the real Tandoor instance**

This is the first point in the plan that needs the user's actual Tandoor URL and API token (generate one in Tandoor under Settings -> API).

```bash
cat > /tmp/tandoor-mcp-config/config.yaml <<EOF
tandoor:
  url: <your real Tandoor URL>
  token: <your real Tandoor API token>
mcp:
  bearer_token: $(openssl rand -hex 32)
permissions:
  safe_write: true
  destructive: false
EOF
TANDOOR_MCP_CONFIG_DIR=/tmp/tandoor-mcp-config npm run dev
```

Connect a real MCP client (e.g. Claude Desktop or Claude Code's MCP config) pointed at `http://127.0.0.1:6061/mcp` with that bearer token, and manually exercise: `search_recipes`, `get_recipe`, `list_reference_data` for each kind, `get_shopping_list`, `create_recipe` (preview, then confirm), `plan_meals` (preview, then confirm), `get_meal_plan` to see the new entry. Confirm each response looks sane against what Tandoor's own UI shows. Note anywhere a confirmed API shape (Task 15's food/unit POST, Task 21's meal-plan GET) turns out wrong, and fix the corresponding client method before proceeding — this is the cheapest point to catch it.

- [ ] **Step 7: Run the full suite** — `npm run typecheck && npm run lint && npm test` — expected all pass.

- [ ] **Step 8: Commit**

```bash
git add src/tools/register.ts src/index.ts src/bootstrap.ts test/register.test.ts test/app.test.ts
git commit -m "Register all tools and wire them into the server entrypoint"
```

**Phase 3 checkpoint:** every tool in the design spec is implemented, tested against fake fetch, and manually verified against a real Tandoor instance. This is the substantial-review point — the server is functionally complete. Phases 4-5 add documentation and release plumbing around it.

---

## Phase 4 — Security and contributing docs

These are prose tasks: before writing any of them, invoke the `documentation-writing` skill if it is available in the executing session, and write with `Write`/`Edit` rather than a shell heredoc so any doc-writing hook sees the file. No TDD steps — the "test" for a doc is a careful read-through against the rules below plus the self-review checklist that skill provides.

### Task 24: docs/security.md — OWASP MCP Top 10

**Files:** Create: `docs/security.md`

Adapted directly from `~/git/arr-mcp/docs/security.md`'s structure (read that file in full before writing this one, to match its exact per-risk three-part shape — the risk / what tandoor-mcp does / what it does not solve). Differences from arr-mcp's version, all load-bearing:

- Single Tandoor instance, one credential, one permission set — no "per instance" language anywhere.
- No config UI, so drop every reference to a config-UI password, session cookie, login throttling, and the repair page.
- `BIND_ADDR` defaults to `127.0.0.1`, not `0.0.0.0` — MCP07's "why 0.0.0.0" framing inverts: tandoor-mcp is *not* reachable across the LAN unless you deliberately rebind it, so `allowed_hosts` is offered as defense-in-depth for the case where you do, not a load-bearing default-on protection.
- MCP04 (supply chain): name tandoor-mcp's actual dependency count from `package.json` (Task 1) rather than arr-mcp's "eight" — count them when writing this.
- No IMDb/metadata dataset, no `get_stack_health`, no multi-service `diagnose` chain — omit every reference to those.
- MCP01's "Audit arguments pass through a key-name redactor" point carries over verbatim — `src/core/audit.ts`'s `scrub()` (Task 5) is the same mechanism.
- MCP03's fencing section carries over near-verbatim — `src/core/fence.ts` (Task 3) is a direct port, applied to recipe descriptions, step instructions, ingredient notes, meal-plan notes, and cook-log comments instead of release names and overviews.
- MCP06's confirm-handshake section carries over near-verbatim — `src/core/confirm.ts` (Task 5) is a direct port.
- MCP08's audit section carries over near-verbatim — `src/core/audit.ts` (Task 5) is a direct port, minus the "config UI log pages" reference (no config UI).
- MCP09: tandoor-mcp is inherently "one server for the whole stack" in the trivial sense of having only one stack (Tandoor) — reframe that paragraph rather than deleting it outright, since the `io.modelcontextprotocol.server.name` label point (Task 32) still applies.
- Drop the "Sources" section's arXiv/Forkast citations unless the same sources are still current when this is written — keep the OWASP MCP Top 10 link, drop or update the rest.

Write the full document now, following that structure and those differences, section by section: title and one-paragraph intro naming the OWASP MCP Top 10 as the structure and linking to `SECURITY.md` for reporting; "The threat model first" (single-operator appliance, one bearer token, one permission set, not multi-tenant, not internet-facing, the two-question table); then MCP01 through MCP10 in order, each with **The risk.** / **What tandoor-mcp does.** / **What it does not solve.**; then "What this page does not cover"; then "Sources".

- [ ] **Step 1: Read `~/git/arr-mcp/docs/security.md` in full** (already done once during design; re-read if this task runs in a fresh session/subagent with no memory of that read).

- [ ] **Step 2: Write docs/security.md**, applying every difference listed above. Do not leave any arr-mcp-specific noun (Radarr, Sonarr, config UI, IMDb, "0.0.0.0 by design") in the final text — grep the draft for those words before moving on.

- [ ] **Step 3: Cross-check against the actual codebase** — for each "What tandoor-mcp does" bullet, confirm the file and behavior it names still exists and does what the bullet claims (e.g. open `src/core/fence.ts` and confirm the bidi-override range is really stripped, open `src/tools/write.ts` and confirm the confirm-token binding really covers tier/target/args). A security doc that oversells its own mitigations is worse than one that undersells them.

- [ ] **Step 4: Commit**

```bash
git add docs/security.md
git commit -m "Add docs/security.md: OWASP MCP Top 10 threat model"
```

---

### Task 25: SECURITY.md — vulnerability reporting policy

**Files:** Create: `SECURITY.md`

Adapted from `~/git/arr-mcp/SECURITY.md` (read in full — it is short). Same structure: reporting instructions (GitHub private security advisories, with the same "open a normal issue asking for a private channel" fallback), what to expect (one-person project, no SLA, no bounty, latest-release-only support), an in-scope list, and a known-not-a-vulnerability list.

Differences from arr-mcp's version:

- In-scope list drops "config UI" entirely and drops "bypass of `allowed_hosts`" only if Task 24 concluded `allowed_hosts` is defense-in-depth rather than load-bearing — keep it in-scope regardless, since a bypass is still a real bug even if the default posture doesn't rely on it.
- Known-not-a-vulnerability list: replace "binding 0.0.0.0" with the opposite framing — binding loopback by default and requiring an explicit `BIND_ADDR` change to expose it further is the point, so the corresponding entry should instead cover "no OAuth" (single bearer token by design, link to MCP07) and "config.yaml is plaintext" (link to MCP01), both still true here.
- Reporting recipient/repo URL: use this project's actual GitHub path once Task 31/32 settles what it is; leave the exact URL as the one placeholder in this task explicitly (not a violation of "no placeholders" — it is genuinely unknown until the repo is pushed, and the step below says what to do about it).

- [ ] **Step 1: Read `~/git/arr-mcp/SECURITY.md` in full.**

- [ ] **Step 2: Write SECURITY.md** with the differences above. Use `github.com/<owner>/tandoor-mcp` as the repository path, and leave a one-line TODO comment (visible only in the plan, not in the shipped file — the shipped file must state a real path) reminding whoever runs this task to fill in the real GitHub username/org before committing.

- [ ] **Step 3: Commit**

```bash
git add SECURITY.md
git commit -m "Add SECURITY.md: vulnerability reporting policy"
```

---

### Task 26: CONTRIBUTING.md

**Files:** Create: `CONTRIBUTING.md`

Adapted from `~/git/arr-mcp/CONTRIBUTING.md`'s section structure (summarized in detail during design research — re-read the real file if this task runs in a fresh session and the summary is insufficient for a section). Keep these sections, each rewritten for tandoor-mcp's actual shape:

- **"You do not need Tandoor running"** (arr-mcp: "You do not need a media stack") — `npm install && npm test` needs no live instance; only a maintainer with a real Tandoor runs `npm run capture` (Task 28).
- **"The three gates"** — `npm run lint` / `npm run typecheck` / `npm test`, CI runs exactly what you can run locally.
- **"If you are working with a coding agent"** — same four rules: never hand-write a fixture (capture it or say it's missing), paste actual gate output, state what a human actually exercised against a real Tandoor instance, fix a generated-type mismatch at the mapper rather than casting it away.
- **"Dependencies"** — Dependabot for npm + GitHub Actions + Docker, grouped monthly, security updates exempted.
- **"Commit messages"** — Conventional Commits, with tandoor-mcp's own breaking/minor definitions: renaming or removing a tool or a tool parameter, or removing a field from a tool's structured output, is breaking; adding a tool, an optional parameter, or an additive output field is minor.
- **"The tool surface is the public API"** — the 14 tools from Task 23 are it; extend one of them before adding a fifteenth, and justify a new tool in the PR description the way arr-mcp requires a stated reason.
- **"If your tool returns free text"** — mandates `fenceText` (Task 3), naming which Tandoor fields already need it (description, instructions, notes, comments) so a new field gets checked against that list.
- **"Adding a write tool"** — must go through `registerWriteTool` (Task 7); `plan()` is pure and does a read-before-write; tier is chosen by "what does undo cost" — reversible is `safe`, data loss is `destructive`, ties default to `destructive`.
- **"Vendored API spec"** — `specs/tandoor.json` (Task 27) is fetched, not hand-edited; regenerate with `npm run specs:fetch && npm run codegen` and review the diff.
- **"Recorded fixtures"** — `test/fixtures/*.json` (Task 28) are captured from a real instance and scrubbed, never hand-written; `npm run capture` is maintainer-only.
- **"Reporting a bug"** — Tandoor version, deployment method, redacted logs.

Drop entirely: "Adding a service adapter" (there is one client, not a registry — nothing to add), "Working on the config UI" (no config UI), "Screenshots" (no config UI to screenshot).

- [ ] **Step 1: Write CONTRIBUTING.md** with the sections above, in that order.

- [ ] **Step 2: Cross-check every command it tells a contributor to run** (`npm test`, `npm run lint`, `npm run typecheck`, `npm run specs:fetch`, `npm run codegen`, `npm run capture`) against `package.json`'s actual `scripts` block (Task 1, extended by Task 27) — every name mentioned must exist verbatim.

- [ ] **Step 3: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "Add CONTRIBUTING.md"
```

**Phase 4 checkpoint:** the three governance docs exist, describe the codebase as it actually is (not as arr-mcp's does), and every command they mention actually exists in `package.json`.

---

## Phase 5 — Fixtures, contract testing, Docker, CI/release

### Task 27: Vendor Tandoor's OpenAPI spec and generate types

**Files:**
- Create: `scripts/fetch-specs.sh`
- Create: `scripts/codegen.mjs`
- Modify: `package.json` (add `openapi-typescript` devDependency — already has the `specs:fetch`/`codegen` scripts from Task 1)
- Create: `specs/.gitkeep` (the fetched `specs/tandoor.json` itself is gitignored per Task 1's `.gitignore`, since it's fetched not hand-maintained — reconsider this against arr-mcp's own practice before committing: arr-mcp *commits* its vendored specs specifically so the nightly drift job's diff is reviewable. Change `.gitignore` to NOT ignore `specs/*.json` and commit the fetched spec instead, matching that reasoning — a gitignored spec makes `openapi-drift.yml` (Task 31) meaningless, since there is nothing to diff against.)

`TandoorClient` (Tasks 9-22) does **not** consume the generated types — it uses its own hand-written `src/client/types.ts`, matching what both existing Tandoor MCP implementations do. The generated types exist so `test/contract.test.ts` (Task 29) can check the vendored spec's declared response schema against what each tool actually reads, catching upstream drift; wiring `TandoorClient` itself onto generated types is a reasonable future refactor, not required for v1.

- [ ] **Step 1: First, undo Task 1's `.gitignore` line for specs**

Edit `.gitignore`, removing the `specs/*.json` line (keep `src/generated` ignored — generated types are rebuilt by `npm run codegen`, not committed, since arr-mcp does not commit its generated output either).

- [ ] **Step 2: Write scripts/fetch-specs.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fetches Tandoor's OpenAPI schema (drf-spectacular, default path /api/schema/)
# and writes it reformatted, so the committed diff shows semantic drift rather
# than reflow noise. Needs TANDOOR_URL in the environment.

: "${TANDOOR_URL:?Set TANDOOR_URL to your Tandoor instance, e.g. https://recipes.example.com}"

mkdir -p specs
curl -fsSL "${TANDOOR_URL%/}/api/schema/" -o /tmp/tandoor-spec-raw.json

node -e "
const fs = require('node:fs');
const doc = JSON.parse(fs.readFileSync('/tmp/tandoor-spec-raw.json', 'utf8'));
fs.writeFileSync('specs/tandoor.json', JSON.stringify(doc, null, 2) + '\n');
"

rm -f /tmp/tandoor-spec-raw.json
echo "Wrote specs/tandoor.json"
```

If `/api/schema/` 404s against a real instance (some self-hosted Tandoor deployments disable drf-spectacular), this script fails loudly rather than writing a partial file — that failure is itself useful information for Task 28/29, which then fall back to fixture-only contract checks with no `spec` field, exactly as arr-mcp does for the four *arr-family services with no published OpenAPI spec.

- [ ] **Step 3: Write scripts/codegen.mjs**

```js
#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

if (!existsSync('specs/tandoor.json')) {
    console.error('specs/tandoor.json is missing — run `npm run specs:fetch` first.');
    process.exit(1);
}

mkdirSync('src/generated', { recursive: true });

// Pinned and run via npx, matching arr-mcp's own reasoning: dodges a
// TypeScript peer-version conflict with this project's own pinned compiler.
execFileSync('npx', ['--yes', 'openapi-typescript@7.13.0', 'specs/tandoor.json', '-o', 'src/generated/tandoor.ts'], { stdio: 'inherit' });

console.log('Wrote src/generated/tandoor.ts');
```

- [ ] **Step 4: Add openapi-typescript as a devDependency**

```bash
npm install --save-dev openapi-typescript@7.13.0
```

- [ ] **Step 5: Run against the real instance to prove the scripts work**

```bash
chmod +x scripts/fetch-specs.sh
TANDOOR_URL=<your real Tandoor URL> npm run specs:fetch
npm run codegen
```

Expected: `specs/tandoor.json` and `src/generated/tandoor.ts` both exist and are non-trivial (specs/tandoor.json should contain `"paths"` with `/api/recipe/` among the keys — grep for it). If `/api/schema/` 404s, note that in this task's outcome and skip straight to Task 29 building `CONTRACTS` entries with no `spec` field for every dependency, matching arr-mcp's no-published-spec fallback.

- [ ] **Step 6: Run the full suite** — `npm run typecheck && npm run lint && npm test` — expected all pass (nothing yet depends on the generated file, so this mainly confirms Step 1's `.gitignore` edit didn't break anything).

- [ ] **Step 7: Commit**

```bash
git add .gitignore scripts/fetch-specs.sh scripts/codegen.mjs package.json package-lock.json specs/tandoor.json
git commit -m "Vendor Tandoor's OpenAPI spec and add codegen"
```

---

### Task 28: Capture real fixtures

**Files:** Create: `scripts/capture-fixtures.ts`

Run only by a maintainer against their own real Tandoor instance — never in CI, never by a contributor without one. Captures a real response per endpoint each tool reads, scrubs credentials and identity, writes to `test/fixtures/*.json`.

- [ ] **Step 1: Write scripts/capture-fixtures.ts**

```ts
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { TandoorClient } from '../src/client/tandoorClient.ts';
import { loadConfig } from '../src/config/load.ts';

const CONFIG_DIR = process.env.TANDOOR_MCP_CONFIG_DIR ?? process.argv[2];
if (CONFIG_DIR === undefined) {
    console.error('Usage: TANDOOR_MCP_CONFIG_DIR=<dir with config.yaml> npm run capture');
    process.exit(1);
}

const config = loadConfig(CONFIG_DIR);
const client = new TandoorClient(config.tandoor.url, config.tandoor.token, config.tandoor.timeout_ms);

/** Recursively drops any key that looks like a credential; refuses to write
 *  the file at all if one survives serialization regardless. */
const CREDENTIAL_KEY = /(api[_-]?key|token|password|secret|authorization)/i;
function scrubCredentials(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(scrubCredentials);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, CREDENTIAL_KEY.test(k) ? '__REDACTED__' : scrubCredentials(v)]));
    }
    return value;
}

/** Identity fields worth scrubbing per Tandoor's actual response shapes —
 *  extend this list rather than adding a blanket key-name rule, since
 *  `created_by` is a bare user id (not obviously identity-shaped) but still
 *  worth dropping from a committed fixture. */
const IDENTITY_KEYS = new Set(['created_by', 'completed_by']);
function scrubIdentity(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(scrubIdentity);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([k]) => !IDENTITY_KEYS.has(k))
                .map(([k, v]) => [k, scrubIdentity(v)])
        );
    }
    return value;
}

function write(name: string, data: unknown): void {
    const scrubbed = scrubIdentity(scrubCredentials(data));
    const text = JSON.stringify(scrubbed, null, 2) + '\n';
    if (CREDENTIAL_KEY.test(text)) {
        throw new Error(`refusing to write fixture "${name}": a credential-shaped key survived scrubbing`);
    }
    mkdirSync('test/fixtures', { recursive: true });
    writeFileSync(`test/fixtures/${name}.json`, text);
    console.log(`wrote test/fixtures/${name}.json`);
}

// One capture per endpoint every tool reads. Extend this list whenever a new
// tool starts reading a field this list's fixtures don't cover.
write('recipe-search', await client.searchRecipes({ limit: 5 }));
write('recipe-detail', await client.getRecipe((await client.searchRecipes({ limit: 1 })).results[0]?.id ?? 0));
write('keywords', await client.searchKeywords('', 20));
write('units', await client.getUnits(undefined, 50));
write('foods', await client.searchFoods('', 50));
write('meal-types', await client.getMealTypes());
write('meal-plan', await client.getMealPlans('2020-01-01', '2030-01-01'));
write('shopping-list', await client.getShoppingList());
write('cook-log', await client.getCookLog({}));

console.log('Done. Review test/fixtures/*.json for anything identity-shaped this script did not know to scrub before committing.');
```

- [ ] **Step 2: Run it against the real instance**

```bash
TANDOOR_MCP_CONFIG_DIR=/tmp/tandoor-mcp-config npm run capture
```

Expected: nine files under `test/fixtures/`. Open each one and read it — this script's scrub lists are a starting point, not a guarantee; if a real user's name, email, or a real household member's name shows up anywhere (a `created_by` field only carries an id per the current types, but a future Tandoor version could change that), extend `IDENTITY_KEYS` and re-run before committing. If any fixture is an empty list (e.g. an empty cook log), note that in a comment in Task 29 — an empty fixture cannot contract-test the fields that endpoint would carry, matching arr-mcp's own documented gap for Radarr/Sonarr/Bazarr health dependencies.

- [ ] **Step 3: Commit**

```bash
git add scripts/capture-fixtures.ts test/fixtures
git commit -m "Add fixture capture script and initial captured fixtures"
```

---

### Task 29: Contract tests

**Files:** Create: `test/contract.test.ts`

Ported near-verbatim from `~/git/arr-mcp/test/contract.test.ts`'s generic machinery (`fixtureHasField`, `resolveResponseSchema`, `declaredProperties`, `specDeclaresField`) — read that file's full implementation (already captured in detail during design research) before writing this one, since these four functions are copied as-is with no Tandoor-specific changes. Only the `CONTRACTS` map and its test loop are new.

- [ ] **Step 1: Write test/contract.test.ts**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

type Dependency = { path?: string; method?: 'get' | 'post'; fixture: string; fields: string[] };
type ServiceContract = { spec?: string; dependencies: Dependency[] };

function sampleHasField(sample: unknown, dotted: string): boolean {
    if (sample === undefined || sample === null) return false;
    let node: unknown = sample;
    for (const part of dotted.split('.')) {
        const here = Array.isArray(node) ? node[0] : node;
        if (here === null || typeof here !== 'object' || !(part in here)) return false;
        node = (here as Record<string, unknown>)[part];
    }
    return true;
}

export function fixtureHasField(fixture: unknown, dotted: string): boolean {
    const samples = Array.isArray(fixture) ? fixture : [fixture];
    return samples.some(sample => sampleHasField(sample, dotted));
}

const deref = (spec: Record<string, unknown>, node: unknown): unknown => {
    let current = node;
    for (let hops = 0; hops < 10; hops += 1) {
        const ref = (current as Record<string, unknown> | undefined)?.['$ref'];
        if (typeof ref !== 'string' || !ref.startsWith('#/')) return current;
        current = ref
            .slice(2)
            .split('/')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], spec);
    }
    return current;
};

export function resolveResponseSchema(spec: unknown, path: string, method: string): unknown {
    const doc = spec as Record<string, never>;
    const operation = (doc.paths as Record<string, never> | undefined)?.[path]?.[method];
    if (operation === undefined) return undefined;
    const responses = (operation as Record<string, never>).responses as Record<string, never> | undefined;
    const ok = responses?.['200'] ?? responses?.default;
    const content = (ok as Record<string, never> | undefined)?.content as Record<string, never> | undefined;
    const media = content?.['application/json'] ?? Object.values(content ?? {})[0];
    return (media as Record<string, never> | undefined)?.schema;
}

function declaredProperties(spec: Record<string, unknown>, node: unknown): Record<string, unknown> | undefined {
    let current = deref(spec, node);
    for (let hops = 0; hops < 10; hops += 1) {
        const here = current as Record<string, unknown> | undefined;
        if (here === undefined || here === null) return undefined;
        if (here.properties !== undefined) return here.properties as Record<string, unknown>;
        if (here.items !== undefined) {
            current = deref(spec, here.items);
            continue;
        }
        const branches = (here.allOf ?? here.oneOf ?? here.anyOf) as unknown[] | undefined;
        if (branches === undefined) return undefined;
        if (branches.length === 1) {
            current = deref(spec, branches[0]);
            continue;
        }
        const merged: Record<string, unknown> = {};
        for (const branch of branches) Object.assign(merged, declaredProperties(spec, branch) ?? {});
        return merged;
    }
    return undefined;
}

export function specDeclaresField(spec: unknown, schema: unknown, dotted: string): boolean {
    const doc = spec as Record<string, unknown>;
    let node = schema;
    for (const part of dotted.split('.')) {
        const properties = declaredProperties(doc, node);
        if (properties === undefined || !(part in properties)) return false;
        node = properties[part];
    }
    return true;
}

/**
 * What each tool actually reads off a given endpoint's response, checked
 * against both the captured fixture and (where a spec was fetched, see Task
 * 27) the vendored OpenAPI schema. Update this whenever a tool starts
 * reading a new field.
 */
const CONTRACTS: Record<string, ServiceContract> = {
    tandoor: {
        spec: 'specs/tandoor.json',
        dependencies: [
            { path: '/api/recipe/', method: 'get', fixture: 'test/fixtures/recipe-search.json', fields: ['results.id', 'results.name', 'results.description', 'results.rating', 'results.servings', 'results.keywords'] },
            {
                path: '/api/recipe/{id}/',
                method: 'get',
                fixture: 'test/fixtures/recipe-detail.json',
                fields: ['id', 'name', 'servings', 'steps.instruction', 'steps.ingredients.food.name', 'steps.ingredients.unit.name', 'steps.ingredients.amount', 'steps.ingredients.is_header', 'steps.ingredients.no_amount']
            },
            { path: '/api/keyword/', method: 'get', fixture: 'test/fixtures/keywords.json', fields: ['results.id', 'results.name'] },
            { path: '/api/unit/', method: 'get', fixture: 'test/fixtures/units.json', fields: ['results.id', 'results.name'] },
            { path: '/api/food/', method: 'get', fixture: 'test/fixtures/foods.json', fields: ['results.id', 'results.name', 'results.food_onhand'] },
            { path: '/api/meal-type/', method: 'get', fixture: 'test/fixtures/meal-types.json', fields: ['results.id', 'results.name', 'results.order'] },
            {
                path: '/api/meal-plan/',
                method: 'get',
                fixture: 'test/fixtures/meal-plan.json',
                fields: ['results.id', 'results.date', 'results.meal_type.name', 'results.recipe.id', 'results.recipe.name', 'results.servings']
            },
            { path: '/api/shopping-list-entry/', method: 'get', fixture: 'test/fixtures/shopping-list.json', fields: ['results.id', 'results.food.name', 'results.amount', 'results.checked'] },
            { path: '/api/cook-log/', method: 'get', fixture: 'test/fixtures/cook-log.json', fields: ['results.id', 'results.recipe.name', 'results.servings', 'results.created'] }
        ]
    }
};

describe('adapter contracts', () => {
    for (const [service, contract] of Object.entries(CONTRACTS)) {
        describe(service, () => {
            for (const dep of contract.dependencies) {
                const label = dep.path ?? dep.fixture.split('/').pop();

                it(`${label} still returns the fields tools read`, () => {
                    const fixture = read(dep.fixture);
                    const missing = dep.fields.filter(f => !fixtureHasField(fixture, f));
                    expect(missing, 'missing from the recorded response').toEqual([]);
                });

                const spec = contract.spec;
                const path = dep.path;
                const method = dep.method ?? 'get';

                if (spec !== undefined && path !== undefined) {
                    it(`${label} still declares those fields in the vendored spec`, () => {
                        const doc = read(spec);
                        const schema = resolveResponseSchema(doc, path, method);
                        expect(schema, `no ${method} ${path} in ${spec}`).toBeDefined();
                        const missing = dep.fields.filter(f => !specDeclaresField(doc, schema, f));
                        expect(missing, 'upstream renamed or removed a field we read').toEqual([]);
                    });
                }
            }
        });
    }
});
```

Note: the `/api/recipe/{id}/` path key must exactly match the path template as Tandoor's spec declares it (drf-spectacular may render the path parameter differently, e.g. `{id}` vs a named convention) — check `specs/tandoor.json`'s actual `paths` keys after Task 27 and correct this entry if it doesn't match, before trusting a green result here.

- [ ] **Step 2: Run it** — `npx vitest run test/contract.test.ts` — expected PASS if Task 27/28 produced a real spec and fixtures; if `/api/schema/` 404'd in Task 27, drop the `spec` field from the `tandoor` entry and skip the spec-declares assertions, matching arr-mcp's no-spec fallback, and note that in this task's outcome.

- [ ] **Step 3: Run the full suite** — `npm run typecheck && npm run lint && npm test` — expected all pass.

- [ ] **Step 4: Commit**

```bash
git add test/contract.test.ts
git commit -m "Add OpenAPI-fixture contract tests"
```

**Phase 5a checkpoint (fixtures/contract):** `npm test` now includes a real drift check against Tandoor's own declared API surface, using real captured data — the last piece of the "same OpenAPI fixture testing" requirement from the original ask.

---

### Task 30: Dockerfile, entrypoint, compose example

**Files:**
- Create: `Dockerfile`
- Create: `docker-entrypoint.sh`
- Create: `docker-compose.example.yml`
- Create: `.dockerignore`

Adapted from `~/git/arr-mcp/Dockerfile`/`docker-entrypoint.sh` (both read in full during design research) — same multi-stage/pinned-digest/non-root/PUID-PGID/healthcheck shape, renamed for tandoor-mcp and its config keys.

- [ ] **Step 1: Write .dockerignore**

```
node_modules
dist
coverage
.git
config
```

- [ ] **Step 2: Write Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

# Pinned by digest, not by tag, for the same reason arr-mcp's is: a silent
# upstream re-tag must not change the glibc a prebuilt native addon
# (better-sqlite3) was compiled against without a diff to review. Update this
# digest deliberately, via Dependabot's docker ecosystem watch (Task 31).
FROM node:24-trixie-slim@sha256:6950b66b4c0cb0151ce89fa75074673850763d096b044f422c6729b588dd4956 AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim@sha256:6950b66b4c0cb0151ce89fa75074673850763d096b044f422c6729b588dd4956 AS runtime
WORKDIR /app

ARG TANDOOR_MCP_VERSION=0.0.0-dev

LABEL io.modelcontextprotocol.server.name="io.github.dgibbons/tandoor-mcp"

RUN apt-get update && apt-get install -y --no-install-recommends gosu wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    TANDOOR_MCP_CONFIG_DIR=/config \
    BIND_ADDR=0.0.0.0:6061 \
    TANDOOR_MCP_VERSION=$TANDOOR_MCP_VERSION \
    PUID=1000 \
    PGID=1000

VOLUME ["/config"]
EXPOSE 6061

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- "http://localhost:${BIND_ADDR##*:}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
```

Note the deliberate difference from arr-mcp here, worth calling out in a code comment when writing this file: the design spec defaults `BIND_ADDR` to `127.0.0.1:6061` for a bare `node dist/src/index.js` run, but the **container** image overrides that default to `0.0.0.0:6061` via `ENV`, because a process bound to its own loopback inside a container is unreachable from the host even with `-p 6061:6061` published — the container's loopback is not the host's. This is not a security regression: reachability from outside the container still depends entirely on whether the operator publishes the port, which `docker-compose.example.yml` (Step 4) makes an explicit, visible choice rather than a hidden default.

- [ ] **Step 3: Write docker-entrypoint.sh**

```bash
#!/bin/sh
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}
CONFIG_DIR=${TANDOOR_MCP_CONFIG_DIR:-/config}

if [ "$(id -u)" = "0" ]; then
    mkdir -p "$CONFIG_DIR"
    chown -R "$PUID:$PGID" "$CONFIG_DIR"
    exec gosu "$PUID:$PGID" "$@"
fi

mkdir -p "$CONFIG_DIR" 2>/dev/null || true
if [ ! -w "$CONFIG_DIR" ]; then
    echo "tandoor-mcp: $CONFIG_DIR is not writable by uid $(id -u)." >&2
    echo "  Running with --user means the container cannot fix this itself." >&2
    echo "  Either chown the directory on the host:" >&2
    echo "      chown -R $(id -u):$(id -g) <your config dir>" >&2
    echo "  or drop --user and set PUID/PGID instead." >&2
    exit 1
fi

exec "$@"
```

- [ ] **Step 4: Write docker-compose.example.yml**

```yaml
services:
  tandoor-mcp:
    image: ghcr.io/dgibbons/tandoor-mcp:latest
    restart: unless-stopped
    ports:
      - "6061:6061"
    volumes:
      - ./config:/config
    environment:
      PUID: "1000"
      PGID: "1000"
      # TZ: America/New_York
```

`config/config.yaml` inside the mounted volume holds `tandoor.url`, `tandoor.token`, `mcp.bearer_token`, and `permissions` — see `config.example.yaml` for every key. Generate a bearer token with `openssl rand -hex 32` before first start.

- [ ] **Step 5: Build and smoke-test the image locally**

```bash
docker build -t tandoor-mcp:dev .
docker run --rm -p 6061:6061 -v /tmp/tandoor-mcp-config:/config tandoor-mcp:dev &
sleep 2
curl -s localhost:6061/healthz
docker stop $(docker ps -q --filter ancestor=tandoor-mcp:dev)
```

Expected: `{"status":"ok",...}`.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-entrypoint.sh docker-compose.example.yml .dockerignore
git commit -m "Add Dockerfile, entrypoint, and compose example"
```

---

### Task 31: CI workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/openapi-drift.yml`

Adapted from `~/git/arr-mcp/.github/workflows/ci.yml` (read in full during design research), dropping the multi-platform Docker smoke-test job's arr-mcp-specific arm64/glibc history (keep a single-platform build-and-load-and-run-once check, since tandoor-mcp has the same better-sqlite3 native-addon exposure but no yet-documented arm64 incident to guard against specifically).

- [ ] **Step 1: Write .github/workflows/ci.yml**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-buildx-action@v3
      - name: Build image (no push)
        uses: docker/build-push-action@v7
        with:
          context: .
          push: false
          load: true
          tags: tandoor-mcp:smoke
      - name: Smoke-test the native addon and healthz
        run: |
          docker run -d --rm -p 6061:6061 -e TANDOOR_URL=https://example.invalid -e TANDOOR_TOKEN=x -e MCP_BEARER_TOKEN=$(openssl rand -hex 32) --name tandoor-mcp-smoke tandoor-mcp:smoke
          sleep 3
          curl -sf localhost:6061/healthz
          docker stop tandoor-mcp-smoke
```

Pin the third-party action SHAs (`actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`, `docker/build-push-action`) to their current release commits before committing this file — arr-mcp's own `ci.yml` pins every one, matching its Dependabot `github-actions` ecosystem watch; the version tags above are placeholders for "pin these" specifically, not for content this plan is leaving vague.

- [ ] **Step 2: Write .github/workflows/openapi-drift.yml**

```yaml
name: OpenAPI drift check

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: Re-fetch the spec
        env:
          TANDOOR_URL: ${{ secrets.TANDOOR_URL }}
        run: npm run specs:fetch
      - run: npm run codegen
      - run: npm run typecheck
      - run: npm test -- test/contract.test.ts
      - name: Open a PR if the spec changed
        uses: peter-evans/create-pull-request@v7
        with:
          commit-message: 'chore: refresh vendored Tandoor OpenAPI spec'
          title: 'Tandoor API drift detected'
          branch: openapi-drift
          delete-branch: true
```

This workflow needs a `TANDOOR_URL` repository secret pointing at a real (ideally the maintainer's own) Tandoor instance reachable from GitHub Actions runners — note in the PR description or a repo README section that this is a maintainer-only prerequisite, not something a contributor needs.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/openapi-drift.yml
git commit -m "Add CI and nightly OpenAPI drift workflows"
```

---

### Task 32: Release automation

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `server.json`
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Modify: `package.json` (`repository.url` to the real GitHub path, if not already correct)

Adapted from `~/git/arr-mcp`'s equivalents (all read in full during design research).

- [ ] **Step 1: Write release-please-config.json**

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "tandoor-mcp",
      "changelog-path": "CHANGELOG.md",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "draft": false,
      "prerelease": false,
      "initial-version": "0.1.0",
      "include-component-in-tag": false,
      "extra-files": [
        { "type": "json", "path": "server.json", "jsonpath": "$.version" }
      ]
    }
  }
}
```

- [ ] **Step 2: Write .release-please-manifest.json**

```json
{ ".": "0.1.0" }
```

- [ ] **Step 3: Write server.json**

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.dgibbons/tandoor-mcp",
  "title": "tandoor-mcp",
  "description": "An MCP server for Tandoor Recipes: recipe search and authoring, meal planning, shopping lists, and pantry tracking.",
  "version": "0.1.0",
  "websiteUrl": "https://github.com/dgibbons/tandoor-mcp",
  "repository": { "url": "https://github.com/dgibbons/tandoor-mcp", "source": "github" },
  "packages": [
    {
      "registryType": "oci",
      "identifier": "ghcr.io/dgibbons/tandoor-mcp:latest",
      "runtimeHint": "docker",
      "runtimeArguments": [
        { "type": "named", "name": "-p", "value": "6061:6061", "description": "Publish the MCP port" },
        {
          "type": "named",
          "name": "-v",
          "value": "{config_dir}:/config",
          "description": "Host directory holding config.yaml and the write audit log",
          "isRequired": true,
          "variables": { "config_dir": { "description": "Directory on the host to keep tandoor-mcp's configuration in", "format": "filepath", "isRequired": true } }
        }
      ],
      "environmentVariables": [
        { "name": "PUID", "description": "User id owning the files in /config", "default": "1000" },
        { "name": "PGID", "description": "Group id owning the files in /config", "default": "1000" }
      ],
      "transport": {
        "type": "streamable-http",
        "url": "http://localhost:6061/mcp",
        "headers": [
          {
            "name": "Authorization",
            "description": "Bearer token from mcp.bearer_token in config.yaml",
            "value": "Bearer {token}",
            "isRequired": true,
            "isSecret": true,
            "variables": { "token": { "description": "The mcp.bearer_token value from config.yaml", "isRequired": true, "isSecret": true } }
          }
        ]
      }
    }
  ]
}
```

`server.json` has no `icons` entry, unlike arr-mcp's — add one once an icon asset exists; omitting it entirely is valid per the MCP Registry schema and not a placeholder.

- [ ] **Step 4: Write .github/workflows/release.yml**

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write
  packages: write
  id-token: write
  attestations: write

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      released: ${{ steps.rp.outputs.release_created }}
      version: ${{ steps.rp.outputs.version }}
    steps:
      - uses: googleapis/release-please-action@v5
        id: rp
        with:
          token: ${{ secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json

  image:
    needs: release-please
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Compute tags
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/dgibbons/tandoor-mcp
          tags: |
            type=raw,value=main,enable=${{ needs.release-please.outputs.released != 'true' }}
            type=semver,pattern={{version}},value=${{ needs.release-please.outputs.version }},enable=${{ needs.release-please.outputs.released == 'true' }}
            type=raw,value=latest,enable=${{ needs.release-please.outputs.released == 'true' }}
      - uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          sbom: true
          provenance: mode=max
          build-args: |
            TANDOOR_MCP_VERSION=${{ needs.release-please.outputs.version }}
```

Pin every action SHA the same way as `ci.yml` (Task 31 Step 1's note) before committing. Omit the MCP Registry publish step from arr-mcp's own `release.yml` for now — publishing to the public MCP Registry is a decision to make deliberately once this server is proven working, not a default this plan should force; add it later by copying that step from `~/git/arr-mcp`'s `release.yml` if and when that decision is made.

- [ ] **Step 5: Check package.json's repository.url matches the real path** used throughout this task and Task 25/30/32 (`github.com/dgibbons/tandoor-mcp`, or whatever the real path is if `dgibbons` was a placeholder guess) — fix every file in this task and Task 25/30 consistently if it needs to change.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/release.yml server.json release-please-config.json .release-please-manifest.json package.json
git commit -m "Add release automation: release-please, GHCR publish"
```

**Phase 5 checkpoint, and plan complete:** `npm run typecheck && npm run lint && npm test` all pass; `docker build .` succeeds and the built image answers `/healthz`; contract tests catch drift against a real, captured Tandoor API surface; CI and release workflows exist and reference only scripts/tags that actually exist. This closes out the full design spec — search-recipes-through-release-automation, with the same OWASP evaluation, contributing rules, and OpenAPI fixture testing as `~/git/arr-mcp`, scoped down to one app and one instance.
