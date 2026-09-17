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
