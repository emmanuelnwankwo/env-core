import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, cpSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { consumerEnvironment, quickstartConsumer } from '../scripts/consumer';

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
    return execFileSync(command, args, { cwd, env: consumerEnvironment(process.env), encoding: 'utf8', timeout: 60000 });
}

afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('prevents prototype poisoning in the merge implementation actually loaded by Jest', () => {
    const fromJest = createRequire(require.resolve('jest/package.json'));
    const fromCli = createRequire(fromJest.resolve('jest-cli'));
    const merge = createRequire(fromCli.resolve('jest-config'))('deepmerge') as {
        (target: unknown, source: unknown): Record<string, unknown>;
        all(values: unknown[]): Record<string, unknown>;
    };
    const payload: Record<string, unknown> = JSON.parse('{"__proto__":{"admin":true}}');
    const nested = { session: payload };
    for (const result of [merge(Object.create(null), payload), merge(payload, {}),
        merge({ session: null }, nested).session, merge({ session: undefined }, nested).session,
        merge.all([{ session: null }, nested]).session]) {
        const object = result as Record<string, unknown>;
        expect([null, Object.prototype]).toContain(Object.getPrototypeOf(object));
        expect(object.admin).toBeUndefined();
    }
    expect(Object.prototype).not.toHaveProperty('admin');
    const pattern = /test/;
    expect(merge.all([{ globals: { first: 1 }, values: [1], pattern }, { globals: { second: 2 }, values: [2] }]))
        .toEqual({ globals: { first: 1, second: 2 }, values: [1, 2], pattern });
    expect(merge({ pattern }, {}).pattern).toBe(pattern);
});

describe('packed package', () => {
    it('builds fresh artifacts and supports typed CommonJS and native ESM consumers', () => {
        const directory = fixture();
        mkdirSync(path.join(directory, 'dist'));
        writeFileSync(path.join(directory, 'dist/stale.js'), '');
        for (const file of ['AGENTS.md', 'ROADMAP.md', 'REVIEW_FINDINGS.md', 'context7.json', '.env']) {
            writeFileSync(path.join(directory, file), 'private fixture');
        }
        run('pnpm', ['pack', '--pack-destination', 'packed'], directory);
        const archive = path.join(directory, 'packed', readdirSync(path.join(directory, 'packed'))[0]);
        const files = run('tar', ['-tf', archive], directory).trim().split('\n');
        expect(files.sort()).toEqual([
            'LICENSE', 'README.md', 'package.json',
            ...['cli.js', 'constraints.js', 'errors.js', 'errors.d.ts', 'index.js', 'index.d.ts',
                'index.mjs', 'index.d.mts', 'types.d.ts', 'validators.js'].map(file => `dist/${file}`),
        ].map(file => `package/${file}`).sort());

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
        const cli = path.join(modules, 'package/dist/cli.js');
        const cliFile = openSync(cli, 'r');
        try {
            expect(fstatSync(cliFile).mode & 0o111).not.toBe(0);
            expect(readFileSync(cliFile, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
        } finally {
            closeSync(cliFile);
        }

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
assert.ok(!Object.keys(createRequire(import.meta.url).cache).some(filename => filename.endsWith('/dist/cli.js')));
`);
        const quickstart = quickstartConsumer(readFileSync(path.join(modules, 'package/README.md'), 'utf8'));
        for (const extension of ['cts', 'mts']) writeFileSync(path.join(consumer, `quickstart.${extension}`), quickstart);
        const schemaSource = `import type { EnvSchema } from 'env-core';
const schema = { PACK_PORT: { type: Number, choices: [3000], default: 3000 } } satisfies EnvSchema;
`;
        writeFileSync(path.join(consumer, 'schema.cts'), schemaSource + 'module.exports = schema;\n');
        writeFileSync(path.join(consumer, 'schema.mts'), schemaSource + 'export default schema;\n');
        writeFileSync(path.join(consumer, 'named.mts'), schemaSource + 'export const envSchema = schema;\n');
        writeFileSync(path.join(consumer, 'schema.ts'), schemaSource + 'module.exports = schema;\n');
        const envFile = path.join(consumer, '.env');
        writeFileSync(envFile, 'PACK_PORT=3000\n');
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
                run(process.execPath, [path.join(mode, `quickstart.${extension}`)], consumer);
                expect(JSON.parse(run(process.execPath, [cli, 'check', '--schema', path.join(mode, `schema.${extension}`),
                    '--file', envFile, '--no-process-env', '--json'], consumer))).toEqual({ success: true });
            }
        }
        for (const schema of ['schema.mts', 'schema.cts', 'schema.ts', 'named.mts']) {
            expect(run(process.execPath, [cli, 'example', '--schema', schema], consumer)).toBe('PACK_PORT=\n');
        }
        for (const [args, status, code] of [
            [['check', '--schema', 'missing.mjs'], 2, 'schema_load_failed'],
            [['check', '--schema', 'schema.mts', '--file', 'missing.env'], 2, 'source_load_failed'],
            [['check', '--schema', 'schema.mts', '--bad-option'], 2, 'invalid_arguments'],
        ] as const) {
            const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd: consumer, env: consumerEnvironment(process.env), encoding: 'utf8' });
            expect({ status: result.status, stderr: result.stderr }).toEqual({ status, stderr: '' });
            expect(JSON.parse(result.stdout)).toMatchObject({ success: false, error: { code } });
            expect(result.stderr).toBe('');
        }
        run(process.execPath, [compiler, '-p', '.', '--module', 'Preserve', '--moduleResolution', 'Bundler', '--noEmit'], consumer);
    }, 60000);

    it('fails packing when the source cannot build', () => {
        const directory = fixture();
        writeFileSync(path.join(directory, 'src/index.ts'), "export const broken: number = 'broken';\n");
        const result = spawnSync('pnpm', ['pack', '--pack-destination', 'packed'], {
            cwd: directory,
            env: consumerEnvironment(process.env),
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("Type 'string' is not assignable to type 'number'");
        expect(readdirSync(path.join(directory, 'packed'))).toEqual([]);
    }, 60000);
});
