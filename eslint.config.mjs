import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default defineConfig(
    { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
    {
        files: ['**/*.{js,mjs}'],
        extends: [js.configs.recommended],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['**/*.ts'],
        extends: [js.configs.recommended, typescriptEslint.configs['flat/strict']],
        languageOptions: {
            globals: globals.node,
            parser: tsParser,
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.test.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/no-unnecessary-condition': 'error',
            '@typescript-eslint/consistent-type-exports': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-confusing-void-expression': 'error',
        },
    },
);
