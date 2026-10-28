import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const resolve = createRequire(path.join(root, 'package.json')).resolve;

export function consumerEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(env).filter(([key]) =>
        key !== 'NODE_OPTIONS' && key !== 'NODE_PATH' && !key.startsWith('NUB_')));
}

export function consumerManager(value: string | undefined): string {
    assert.ok(value && ['npm', 'pnpm', 'yarn-classic', 'yarn-modern'].includes(value), 'unknown consumer package manager');
    return value;
}

export function verifyConsumer(manager: string, archive: string, targetNode = process.execPath): void {
    consumerManager(manager);
    const directory = mkdtempSync(path.join(tmpdir(), 'env-core-consumer-'));
    const env = consumerEnvironment(process.env);
    const run = (command: string, args: string[]): void => {
        execFileSync(command, args, { cwd: directory, env, stdio: 'inherit', timeout: 120000 });
    };
    const yarn = manager.startsWith('yarn-') ? resolve(manager === 'yarn-modern'
        ? '@yarnpkg/cli-dist/bin/yarn.js' : 'yarn-classic/bin/yarn.js') : undefined;
    try {
        writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
            name: 'env-core-release-consumer', private: true, version: '1.0.0',
            ...(manager === 'pnpm' ? { packageManager: 'pnpm@12.15.0' } : {}),
        }));
        if (manager === 'npm') run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive]);
        else if (manager === 'pnpm') run('pnpm', ['add', '--ignore-scripts', archive]);
        else {
            if (manager === 'yarn-modern') writeFileSync(path.join(directory, '.yarnrc.yml'), 'nodeLinker: pnp\npnpEnableEsmLoader: true\nenableGlobalCache: false\nenableScripts: false\n');
            run(process.execPath, [yarn as string, 'add', ...(manager === 'yarn-classic' ? ['--ignore-scripts', '--non-interactive', '--registry', 'https://registry.npmjs.org'] : []), archive]);
        }
        const source = `import { strict as assert } from 'node:assert';
import { EnvValidationError, generateEnvExample, loadEnv, validateEnv } from 'env-core';
import type { EnvSchema, EnvSourceOptions, ValidatedEnv } from 'env-core';
const schema = { PORT: Number, DEBUG: { type: Boolean, default: false }, LABEL: { type: String, required: false } } satisfies EnvSchema;
process.env.PORT = '9000';
const values: ValidatedEnv<typeof schema> = validateEnv(schema, { PORT: '3210' });
const port: number = values.PORT;
const debug: boolean = values.DEBUG;
const label: string | undefined = values.LABEL;
assert.equal(validateEnv({ PORT: { type: Number, strict: true } }, { PORT: '3e2' }).PORT, 300);
assert.equal(validateEnv({ PORT: { type: Number, min: 1, max: 65535, integer: true } }, { PORT: '3210' }).PORT, 3210);
assert.throws(() => validateEnv({ NAME: { type: String, choices: ['prod'] } }, { NAME: 'dev' }), EnvValidationError);
assert.equal(validateEnv({ PORT: { type: Number, validate: (value: number) => value > 0 } }, { PORT: '3210' }).PORT, 3210);
assert.throws(() => validateEnv({ TOKEN: { type: String, sensitive: true, validate: (value: string) => value } }, { TOKEN: 'PRIVATE_TOKEN' }),
    (error: unknown) => error instanceof EnvValidationError && error.issues[0].sensitive === true && !JSON.stringify(error).includes('PRIVATE_TOKEN'));
assert.throws(() => validateEnv({ PORT: { type: Number, strict: true } }, { PORT: ' ' }), EnvValidationError);
assert.equal(port, 3210);
assert.equal(debug, false);
assert.equal(label, undefined);
assert.equal(process.env.PORT, '9000');
assert.equal(generateEnvExample({ TOKEN: { type: String, default: 'PRIVATE_TOKEN' } }), 'TOKEN=\\n');
const sourceOptions: EnvSourceOptions = { files: [], processEnv: { PORT: '3210' } };
assert.equal(validateEnv({ PORT: Number }, loadEnv(sourceOptions)).PORT, 3210);
assert.throws(() => validateEnv({ PORT: Number }, { PORT: 'invalid' }), EnvValidationError);
`;
        for (const extension of ['cts', 'mts']) writeFileSync(path.join(directory, `index.${extension}`), source + (extension === 'mts' ? `
const { createRequire } = await import('node:module');
const common = createRequire(import.meta.url)('env-core');
assert.equal(common.validateEnv, validateEnv);
assert.equal(common.EnvValidationError, EnvValidationError);
` : ''));
        if (manager !== 'yarn-modern') {
            writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({
                compilerOptions: {
                    strict: true, target: 'ES2020', module: 'Node16', moduleResolution: 'Node16',
                    types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
                }, include: ['*.cts', '*.mts'],
            }));
            for (const compiler of ['typescript-5', 'typescript']) {
                run(process.execPath, [resolve(`${compiler}/bin/tsc`), '-p', '.']);
            }
        } else {
            for (const extension of ['cts', 'mts']) {
                const result = ts.transpileModule(readFileSync(path.join(directory, `index.${extension}`), 'utf8'), {
                    fileName: `index.${extension}`,
                    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.Node16 },
                });
                writeFileSync(path.join(directory, `index.${extension === 'cts' ? 'cjs' : 'mjs'}`), result.outputText);
            }
        }
        for (const extension of ['cjs', 'mjs']) {
            if (yarn) run(targetNode, [yarn, 'node', `index.${extension}`]);
            else run(targetNode, [`index.${extension}`]);
        }
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (path.basename(process.argv[1] ?? '') === 'consumer.ts') {
    const [manager, archive] = process.argv.slice(2);
    assert.ok(archive, 'package archive is required');
    verifyConsumer(consumerManager(manager), path.resolve(archive), process.env.CONSUMER_NODE);
}
