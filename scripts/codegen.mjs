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
