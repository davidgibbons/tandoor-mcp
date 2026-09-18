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
