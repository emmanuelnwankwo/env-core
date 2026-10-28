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

export function readmeQuickstart(readme: string): string {
    const section = /\n## Quickstart\n([\s\S]*?)(?=\n## |$)/.exec(readme)?.[1];
    const source = /```typescript\n([\s\S]*?)\n```/.exec(section ?? '')?.[1];
    assert.ok(source, 'README must contain a complete TypeScript quickstart');
    return source;
}

export function quickstartConsumer(readme: string): string {
    return `${readmeQuickstart(readme)}
import { strict as assert } from 'node:assert';
assert.equal(port, 3000);
assert.equal(debug, false);
assert.throws(() => readConfig({ API_TOKEN: 'PRIVATE_QUICKSTART_TOKEN' }),
    (error: unknown) => error instanceof Error && error.message.includes('missing_required') && !error.message.includes('PRIVATE_QUICKSTART_TOKEN'));
assert.throws(() => readConfig({ PORT: 'invalid', API_TOKEN: 'PRIVATE_QUICKSTART_TOKEN' }),
    (error: unknown) => error instanceof Error && error.message.includes('invalid_value') && !error.message.includes('PRIVATE_QUICKSTART_TOKEN'));
`;
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
import type { EnvSchema, EnvSchemaItem, EnvSourceOptions, ValidatedEnv } from 'env-core';
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
assert.throws(() => validateEnv({ PORT: Number }, { PORT: '0x10' }), EnvValidationError);
assert.equal(validateEnv({ PORT: { type: Number, strict: false } }, { PORT: '0x10' }).PORT, 16);
const booleanChoices: EnvSchemaItem<boolean> = { type: Boolean, choices: [true, false], default: false };
const literalChoices: EnvSchemaItem<'dev' | 'prod'> = { type: String, choices: ['dev', 'prod'] };
const numericChoices: EnvSchemaItem<1 | 2> = { type: Number, choices: [1, 2] };
assert.deepEqual(validateEnv({ FLAG: booleanChoices, MODE: literalChoices, NUMBER: numericChoices },
    { FLAG: 'true', MODE: 'prod', NUMBER: '2' }), { FLAG: true, MODE: 'prod', NUMBER: 2 });
const unsetOptions: EnvSchemaItem<number> = { type: Number, required: undefined, default: undefined,
    strict: undefined, min: undefined, max: undefined, integer: undefined, choices: undefined,
    validate: undefined, sensitive: undefined };
assert.equal(validateEnv({ VALUE: unsetOptions }, { VALUE: '3' }).VALUE, 3);
const processOnly: EnvSourceOptions = { files: [], override: undefined, processEnv: undefined };
assert.equal(validateEnv({ PORT: Number }, loadEnv(processOnly)).PORT, 9000);
const readonlySchema = { OPTIONAL: { type: Number, required: false }, DEFAULT: { type: Number, default: 1 },
    FLAG: { type: Boolean, default: false }, UNSET: { type: Number, required: false, default: undefined } } as const;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type Inference = [Assert<Equal<ValidatedEnv<typeof readonlySchema>['OPTIONAL'], number | undefined>>,
    Assert<Equal<ValidatedEnv<typeof readonlySchema>['DEFAULT'], number>>,
    Assert<Equal<ValidatedEnv<typeof readonlySchema>['FLAG'], boolean>>,
    Assert<Equal<ValidatedEnv<typeof readonlySchema>['UNSET'], number | undefined>>];
const mutable = validateEnv(readonlySchema, {});
mutable.DEFAULT = 2;
mutable.FLAG = true;
assert.equal(mutable.DEFAULT, 2);
export function removedForms() {
    // @ts-expect-error filename loading requires loadEnv
    validateEnv({ PORT: Number }, 'test.env');
    // @ts-expect-error the ignored third argument is removed
    validateEnv({ PORT: Number }, {}, 'test.env');
    // @ts-expect-error typed choices must match the constructor
    validateEnv({ PORT: { type: Number, choices: ['1'] } }, {});
}
`;
        for (const extension of ['cts', 'mts']) writeFileSync(path.join(directory, `index.${extension}`), source + (extension === 'mts' ? `
const { createRequire } = await import('node:module');
const common = createRequire(import.meta.url)('env-core');
assert.equal(common.validateEnv, validateEnv);
assert.equal(common.EnvValidationError, EnvValidationError);
` : ''));
        const quickstart = quickstartConsumer(readFileSync(path.join(root, 'README.md'), 'utf8'));
        for (const extension of ['cts', 'mts']) writeFileSync(path.join(directory, `quickstart.${extension}`), quickstart);
        writeFileSync(path.join(directory, 'schema.cts'), `import type { EnvSchema } from 'env-core';
const schema = { PORT: { type: Number, strict: true, min: 1, default: 3210 },
TOKEN: { type: String, default: 'PRIVATE_TOKEN', sensitive: true } } satisfies EnvSchema;
module.exports = schema;
`);
        if (manager !== 'yarn-modern') {
            writeFileSync(path.join(directory, 'tsconfig.json'), JSON.stringify({
                compilerOptions: {
                    strict: true, exactOptionalPropertyTypes: true, target: 'ES2020', module: 'Node16', moduleResolution: 'Node16',
                    types: ['node'], typeRoots: [path.join(root, 'node_modules/@types')],
                }, include: ['*.cts', '*.mts'],
            }));
            for (const compiler of ['typescript-5', 'typescript']) {
                run(process.execPath, [resolve(`${compiler}/bin/tsc`), '-p', '.']);
            }
        } else {
            for (const filename of ['index.cts', 'index.mts', 'schema.cts', 'quickstart.cts', 'quickstart.mts']) {
                const result = ts.transpileModule(readFileSync(path.join(directory, filename), 'utf8'), {
                    fileName: filename,
                    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.Node16 },
                });
                writeFileSync(path.join(directory, filename.replace(/\.([cm])ts$/, '.$1js')), result.outputText);
            }
        }
        for (const name of ['index', 'quickstart']) for (const extension of ['cjs', 'mjs']) {
            if (yarn) run(targetNode, [yarn, 'node', `${name}.${extension}`]);
            else run(targetNode, [`${name}.${extension}`]);
        }
        const cli = yarn ? [yarn, 'env-core'] : [path.join(path.dirname(createRequire(path.join(directory, 'package.json')).resolve('env-core')), 'cli.js')];
        const invoke = (args: string[]): string => execFileSync(targetNode, [...cli, ...args], { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
        const check = (filename: string): void => {
            const output = invoke(['check', '--schema', filename, '--no-process-env', '--json']);
            assert.ok(output.split('\n').includes('{"success":true}'));
            assert.ok(!output.includes('PRIVATE_TOKEN'));
        };
        check('schema.cjs');
        const template = invoke(['example', '--schema', 'schema.cjs']);
        assert.ok(template.includes('PORT=\nTOKEN=\n') && !template.includes('PRIVATE_TOKEN'));
        const [major, minor] = execFileSync(targetNode, ['-p', 'process.versions.node'], { env, encoding: 'utf8' }).trim().split('.').map(Number);
        if (major > 22 || (major === 22 && minor >= 18)) check('schema.cts');
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (path.basename(process.argv[1] ?? '') === 'consumer.ts') {
    const [manager, archive] = process.argv.slice(2);
    assert.ok(archive, 'package archive is required');
    verifyConsumer(consumerManager(manager), path.resolve(archive), process.env.CONSUMER_NODE);
}
