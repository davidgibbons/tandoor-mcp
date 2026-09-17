import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** @type {string} */
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const rootDir = dirname(fileURLToPath(import.meta.url));

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
                tsconfigRootDir: rootDir
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
