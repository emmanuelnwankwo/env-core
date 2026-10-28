import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';

const root = path.resolve(__dirname, '..');
const fixtures: string[] = [];

function fixture(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'env-core-package-'));
    fixtures.push(directory);
    for (const name of ['package.json', 'tsconfig.json', 'README.md', 'LICENSE', 'src']) {
        cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    mkdirSync(path.join(directory, 'packed'));
    return directory;
}

function run(command: string, args: string[], cwd: string): string {
    return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
}

afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('packed package', () => {
    it('builds fresh artifacts and supports typed CommonJS and native ESM consumers', () => {
        const directory = fixture();
        mkdirSync(path.join(directory, 'dist'));
        writeFileSync(path.join(directory, 'dist/stale.js'), '');
        run('pnpm', ['pack', '--pack-destination', 'packed'], directory);
        const archive = path.join(directory, 'packed', readdirSync(path.join(directory, 'packed'))[0]);
        const files = run('tar', ['-tf', archive], directory).trim().split('\n');
        expect(files).toEqual(expect.arrayContaining(['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/index.mjs', 'package/dist/index.d.mts']));
        expect(files.some(file => /(?:stale|test\/|src\/|\.env)/.test(file))).toBe(false);

        const consumer = path.join(directory, 'consumer');
        const modules = path.join(consumer, 'node_modules');
        mkdirSync(modules, { recursive: true });
        run('tar', ['-xzf', archive, '-C', modules], directory);
        symlinkSync('package', path.join(modules, 'env-core'), 'dir');
        symlinkSync(path.join(root, 'node_modules/dotenv'), path.join(modules, 'dotenv'), 'dir');
        const manifest = JSON.parse(readFileSync(path.join(modules, 'package/package.json'), 'utf8')) as {
            exports: { import: { types: string; default: string }; require: { types: string; default: string } };
        };
        expect(manifest.exports.import).toEqual({ types: './dist/index.d.mts', default: './dist/index.mjs' });
        expect(manifest.exports.require).toEqual({ types: './dist/index.d.ts', default: './dist/index.js' });
        const esm = readFileSync(path.join(modules, 'package/dist/index.mjs'), 'utf8');
        expect(esm).toContain('export');
        expect(esm).not.toContain('require(');

        const source = `import { strict as assert } from 'node:assert';
import { EnvValidationError, validateEnv } from 'env-core';
import type { EnvIssue, EnvSchema, EnvSchemaItem, ValidatedEnv, EnvValidator } from 'env-core';
const validatePort: EnvValidator<number> = value => value > 0;
assert.equal(validateEnv({ PORT: { type: Number, validate: validatePort } }, { PORT: '3210' }).PORT, 3210);
assert.throws(() => validateEnv({ MISSING: String }, {}), EnvValidationError);
const issue: EnvIssue = { code: 'missing_required', key: 'MISSING', message: 'missing' };
assert.equal(new EnvValidationError([issue]).issues[0].code, 'missing_required');
const schema = { PACK_PORT: Number } satisfies EnvSchema;
const item: EnvSchemaItem<number> = { type: Number };
assert.equal(item.type, Number);
process.env.PACK_PORT = '9000';
const result: ValidatedEnv<typeof schema> = validateEnv(schema, { PACK_PORT: '3000' });
const port: number = result.PACK_PORT;
assert.equal(port, 3000);
assert.equal(process.env.PACK_PORT, '9000');
const flags = validateEnv({ DEBUG: { type: Boolean, default: false }, LABEL: { type: String, required: false } }, {});
const enabled: boolean = flags.DEBUG;
const label: string | undefined = flags.LABEL;
assert.equal(enabled, false);
assert.equal(label, undefined);
export function booleanSchema(defaultValue: boolean) {
    const field: EnvSchemaItem<boolean> = { type: Boolean, default: defaultValue };
    return { DEBUG: field };
}
`;
        writeFileSync(path.join(consumer, 'index.cts'), source);
        writeFileSync(path.join(consumer, 'index.mts'), source + `
const dynamic = await import('env-core');
assert.equal(dynamic.validateEnv, validateEnv);
const { createRequire } = await import('node:module');
const common = createRequire(import.meta.url)('env-core');
assert.equal(common.validateEnv, validateEnv);
assert.equal(common.EnvValidationError, EnvValidationError);
assert.equal(dynamic.default, common);
`);
        writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                strict: true,
                declaration: true,
                target: 'ES2020',
                module: 'Node16',
                moduleResolution: 'Node16',
                types: ['node'],
                typeRoots: [path.join(root, 'node_modules/@types')],
            },
            include: ['*.cts', '*.mts'],
        }));
        const compiler = require.resolve('typescript/bin/tsc');
        for (const mode of ['Node16', 'NodeNext']) {
            run(process.execPath, [compiler, '-p', '.', '--module', mode, '--moduleResolution', mode, '--outDir', mode], consumer);
            for (const extension of ['cjs', 'mjs']) {
                run(process.execPath, [path.join(mode, `index.${extension}`)], consumer);
            }
        }
        run(process.execPath, [compiler, '-p', '.', '--module', 'Preserve', '--moduleResolution', 'Bundler', '--noEmit'], consumer);
    }, 60000);

    it('fails packing when the source cannot build', () => {
        const directory = fixture();
        writeFileSync(path.join(directory, 'src/index.ts'), "export const broken: number = 'broken';\n");
        const result = spawnSync('pnpm', ['pack', '--pack-destination', 'packed'], {
            cwd: directory,
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("Type 'string' is not assignable to type 'number'");
        expect(readdirSync(path.join(directory, 'packed'))).toEqual([]);
    }, 60000);
});
