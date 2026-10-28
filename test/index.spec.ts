import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { EnvValidationError, generateEnvExample, loadEnv, validateEnv } from '../src/index';
import type { EnvSchema, EnvSourceOptions } from '../src/types';
import { runCli } from '../src/cli';

const originalEnv = process.env;
const fixtures: string[] = [];

describe('CLI', () => {
    async function invoke(args: string[], schema: EnvSchema = { PORT: Number }) {
        let stdout = '';
        let stderr = '';
        const status = await runCli(args, (text, error) => {
            if (error) stderr += text;
            else stdout += text;
        }, async () => ({ default: schema }));
        return { status, stdout, stderr };
    }

    it('shows help without loading a schema', async () => {
        const load = jest.fn<() => Promise<never>>();
        const write = jest.fn<(text: string) => void>();
        expect(await runCli([], write, load)).toBe(0);
        expect(await runCli(['--help'], write, load)).toBe(0);
        expect(write.mock.calls[0][0]).toContain('Usage: env-core');
        expect(load).not.toHaveBeenCalled();
    });

    it.each([
        ['unknown'], ['check'], ['check', '--schema'], ['check', '--schema', '--json'],
        ['check', '--schema', 'schema', '--schema', 'other'], ['check', '--schema', 'schema', '--unknown'],
        ['check', '--schema', 'schema', '--file'], ['example', '--schema', 'schema', '--json'],
        ['example', '--schema', 'schema', '--override'], ['example', '--schema', 'schema', '--no-process-env'],
        ['example', '--schema', 'schema', '--file', 'file'],
    ])('returns safe usage failures for %j', async (...args) => {
        const result = await invoke([...args, '--json']);
        expect(result.status).toBe(2);
        expect(JSON.parse(result.stdout)).toMatchObject({ success: false, error: { code: 'invalid_arguments' } });
        expect(result.stderr).toBe('');
    });

    it('checks process values without revealing successful configuration', async () => {
        process.env.PORT = '3123';
        expect(await invoke(['check', '--schema', 'schema', '--json']))
            .toEqual({ status: 0, stdout: '{"success":true}\n', stderr: '' });
        expect(await invoke(['check', '--schema', 'schema']))
            .toEqual({ status: 0, stdout: 'Environment is valid\n', stderr: '' });
    });

    it('uses ordered file flags, explicit override and isolated process sources', async () => {
        const first = file('PORT=1000');
        const second = file('PORT=2000');
        process.env.PORT = '3000';
        const schema = { PORT: { type: Number, choices: [2000] } };
        const args = ['check', '--schema', 'schema', '--file', first, '--file', second];
        expect((await invoke(args, schema)).status).toBe(1);
        expect((await invoke([...args, '--override'], schema)).status).toBe(0);
        expect((await invoke([...args, '--no-process-env'], schema)).status).toBe(0);
        expect(process.env.PORT).toBe('3000');
    });

    it('omits custom messages and values from both JSON and human diagnostics', async () => {
        process.env.TOKEN = 'PRIVATE_TOKEN';
        for (const sensitive of [true, false]) {
            const schema = { TOKEN: { type: String, sensitive, validate: (value: string) => value } };
            const json = await invoke(['check', '--schema', 'schema', '--json'], schema);
            expect(json.status).toBe(1);
            expect(JSON.parse(json.stdout)).toEqual({ success: false,
                issues: [{ code: 'custom_validation', key: 'TOKEN', ...(sensitive ? { sensitive: true } : {}) }] });
            const text = await invoke(['check', '--schema', 'schema'], schema);
            expect(text.stdout).toBe('');
            expect(text.stderr).toContain('custom_validation');
            expect(JSON.stringify([json, text])).not.toContain('PRIVATE_TOKEN');
        }
        const root = await invoke(['check', '--schema', 'schema', '--json'], null as unknown as EnvSchema);
        expect(JSON.parse(root.stdout)).toEqual({ success: false, issues: [{ code: 'invalid_schema' }] });
    });

    it('reports safe stage codes for module, file and unexpected schema failures', async () => {
        let output = '';
        expect(await runCli(['check', '--schema', 'schema', '--json'], text => { output = text; },
            async () => { throw new Error('PRIVATE_TOKEN'); })).toBe(2);
        expect(JSON.parse(output)).toMatchObject({ error: { code: 'schema_load_failed' } });
        const missing = await invoke(['check', '--schema', 'schema', '--file', 'PRIVATE_TOKEN', '--json']);
        expect(JSON.parse(missing.stdout)).toMatchObject({ error: { code: 'source_load_failed' } });
        const schema = Object.defineProperty({}, 'PORT', { get: () => { throw new Error('PRIVATE_TOKEN'); } }) as EnvSchema;
        const invalid = await invoke(['check', '--schema', 'schema'], schema);
        expect(invalid).toEqual({ status: 2, stdout: '', stderr: 'Unable to validate schema\n' });
        expect(JSON.stringify([output, missing, invalid])).not.toContain('PRIVATE_TOKEN');
    });

    it('accepts named envSchema exports and emits templates without defaults', async () => {
        let output = '';
        expect(await runCli(['example', '--schema', 'schema'], text => { output = text; },
            async () => ({ envSchema: { TOKEN: { type: String, default: 'PRIVATE_TOKEN' } } }))).toBe(0);
        expect(output).toBe('TOKEN=\n');
        expect((await invoke(['example', '--schema', 'schema'], { 'BAD\nKEY': String })).status).toBe(1);
    });
});

describe('environment templates', () => {
    it('emits ordered blank assignments without evaluating definitions, defaults or callbacks', () => {
        const validate = jest.fn(() => { throw new Error('private validator'); });
        const schema = Object.create({ INHERITED: String }) as EnvSchema;
        Object.assign(schema, { TOKEN: { type: String, default: 'PRIVATE_TOKEN', sensitive: true },
            PORT: { type: Number, default: 3000, validate } });
        Object.defineProperty(schema, 'HIDDEN', { get: () => { throw new Error('private getter'); } });
        expect(generateEnvExample(schema)).toBe('TOKEN=\nPORT=\nHIDDEN=\n');
        expect(validate).not.toHaveBeenCalled();
        expect(generateEnvExample({})).toBe('');
        expect(generateEnvExample(JSON.parse('{"__proto__":null,"constructor":null}') as EnvSchema))
            .toBe('__proto__=\nconstructor=\n');
    });

    it('rejects names that could inject lines or cannot form portable assignments', () => {
        for (const key of ['', '1PORT', 'A-B', 'A.B', 'A=B', 'A B', '#A', 'A\n', 'A\r', 'A\nINJECTED=value']) {
            expect(() => generateEnvExample({ [key]: String })).toThrow(EnvValidationError);
        }
        for (const schema of [null, [], 'schema', { [Symbol('hidden')]: String }]) {
            expect(() => generateEnvExample(schema as unknown as EnvSchema)).toThrow(EnvValidationError);
        }
    });
});

describe('explicit file layers', () => {
    it('applies ordered layers and process precedence without modifying any source', () => {
        const first = file('PORT=1000\nONLY_FIRST=first\nEMPTY=base');
        const second = file('PORT=2000\nONLY_SECOND=second\nEMPTY=');
        process.env = { PORT: '3000', PROCESS_ONLY: 'process' };
        const options = { files: [first, second] };
        expect(loadEnv(options)).toEqual({ PORT: '3000', ONLY_FIRST: 'first', ONLY_SECOND: 'second', EMPTY: '', PROCESS_ONLY: 'process' });
        expect(validateEnv({ PORT: Number }, loadEnv({ ...options, override: true }))).toEqual({ PORT: 2000 });
        expect(loadEnv({ files: [second, first], override: true }).PORT).toBe('1000');
        expect(process.env).toEqual({ PORT: '3000', PROCESS_ONLY: 'process' });
        expect(options.files).toEqual([first, second]);
        expect(fs.readFileSync(first, 'utf8')).toContain('PORT=1000');
    });

    it('supports isolated typed sources and safe own keys in a fresh snapshot', () => {
        const base = JSON.parse('{"__proto__":"safe","COUNT":0,"ENABLED":false}') as Record<string, unknown>;
        Object.setPrototypeOf(base, { INHERITED: 'ignored' });
        const source = loadEnv({ files: [], processEnv: base });
        expect(Object.getPrototypeOf(source)).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(source, '__proto__')).toBe(true);
        expect(source.INHERITED).toBeUndefined();
        expect(validateEnv({ COUNT: Number, ENABLED: Boolean }, source)).toEqual({ COUNT: 0, ENABLED: false });
        base.COUNT = 1;
        expect(source.COUNT).toBe(0);
        process.env.PORT = '9000';
        expect(loadEnv({ files: [], processEnv: {} })).toEqual({});
    });

    it('reads relative paths explicitly and does not implicitly load .env', () => {
        fs.writeFileSync(path.join(process.cwd(), '.env'), 'PORT=1000');
        expect(loadEnv({ files: [], processEnv: {} })).toEqual({});
        expect(loadEnv({ files: ['.env'], processEnv: {} })).toEqual({ PORT: '1000' });
    });

    it('rejects malformed options before reading any files', () => {
        const read = jest.spyOn(fs, 'readFileSync');
        for (const options of [null, [], {}, { files: '.env' }, { files: ['.env', ''] }, { files: [null] },
            { files: Array(1) }, { files: [], override: 'yes' }, { files: [], processEnv: null }, { files: [], processEnv: [] }]) {
            expect(() => loadEnv(options as unknown as EnvSourceOptions)).toThrow(TypeError);
        }
        expect(read).not.toHaveBeenCalled();
    });

    it('fails explicit missing and unreadable layers with the original cause', () => {
        const first = file('PORT=1000');
        expect(() => loadEnv({ files: [first, path.join(process.cwd(), 'missing')] })).toThrow('ENOENT');
        expect(() => loadEnv({ files: [directory()] })).toThrow('EISDIR');
        const cause = Object.assign(new Error('private contents'), { code: 'EACCES' });
        jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw cause; });
        try {
            loadEnv({ files: [first] });
            throw new Error('expected load failure');
        } catch (error) {
            expect(error).toHaveProperty('cause', cause);
            expect((error as Error).message).not.toContain('private contents');
        }
        expect(process.env).toEqual({});
    });
});

function directory(): string {
    const result = fs.mkdtempSync(path.join(tmpdir(), 'env-core-validation-'));
    fixtures.push(result);
    return result;
}

function file(contents: string): string {
    const result = path.join(directory(), '.env');
    fs.writeFileSync(result, contents);
    return result;
}

beforeEach(() => {
    process.env = {};
    jest.spyOn(process, 'cwd').mockReturnValue(directory());
    jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('unexpected process exit'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
    for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
});

describe('validation', () => {
    it.each([
        ['string', String, 'text', 'text'],
        ['number string', Number, '3000', 3000],
        ['typed number', Number, 3000, 3000],
        ['true string', Boolean, 'true', true],
        ['false string', Boolean, 'false', false],
        ['typed true', Boolean, true, true],
        ['typed false', Boolean, false, false],
    ] as const)('accepts %s values', (_name, type, input, expected) => {
        expect(validateEnv({ VALUE: type }, { VALUE: input })).toEqual({ VALUE: expected });
    });

    it.each([
        [Number, 'secret-invalid-number'], [Number, NaN], [Number, true],
        [Boolean, 'TRUE'], [Boolean, '1'], [Boolean, 0],
        [String, 3000], [String, null], [String, {}], [String, []],
    ] as const)('rejects invalid input for %p', (type, input) => {
        expect(() => validateEnv({ VALUE: type }, { VALUE: input })).toThrow(/VALUE should be a/);
    });

    it.each([
        [{ VALUE: { type: Number, default: 0 } }, { VALUE: 0 }],
        [{ VALUE: { type: String, default: '' } }, { VALUE: '' }],
        [{ VALUE: { type: Boolean, default: false } }, { VALUE: false }],
        [{ VALUE: { type: Number, required: false, default: 8080 } }, { VALUE: 8080 }],
        [{ VALUE: { type: String, required: false } }, {}],
        [{ VALUE: { type: String, required: false, default: undefined } }, {}],
    ] as const)('handles missing values for %p', (schema, expected) => {
        expect(validateEnv(schema, {})).toEqual(expected);
    });

    it.each([
        { VALUE: String },
        { VALUE: { type: String } },
        { VALUE: { type: String, required: true, default: 'fallback' } },
        { VALUE: { type: String, default: undefined } },
    ] as const)('requires missing values for %p', schema => {
        expect(() => validateEnv(schema, {})).toThrow('Missing required field: VALUE');
    });

    it('validates supplied values instead of falling back after an error', () => {
        expect(() => validateEnv({ VALUE: { type: Number, default: 10 } }, { VALUE: 'invalid' }))
            .toThrow('VALUE should be a finite decimal number');
        expect(validateEnv({ VALUE: { type: Number, default: 10 } }, { VALUE: '20' })).toEqual({ VALUE: 20 });
    });

    it('treats own undefined as missing while null remains an invalid supplied value', () => {
        expect(validateEnv({ DEFAULT: { type: Number, default: 0 }, OPTIONAL: { type: Boolean, required: false } },
            { DEFAULT: undefined, OPTIONAL: undefined })).toEqual({ DEFAULT: 0 });
        expect(() => validateEnv({ VALUE: { type: Number, required: true, default: 0 } }, { VALUE: undefined }))
            .toThrow('Missing required field: VALUE');
        expect(() => validateEnv({ VALUE: { type: Number, default: 0 } }, { VALUE: null }))
            .toThrow(expect.objectContaining({ issues: [{ code: 'invalid_type', key: 'VALUE', message: expect.any(String) }] }));
    });

    it('aggregates errors without logging, exiting, or exposing values', () => {
        expect(() => validateEnv({ MISSING: String, VALUE: Number }, { VALUE: 'TOP_SECRET' }))
            .toThrow('Environment validation failed:\n- Missing required field: MISSING\n- VALUE should be a finite decimal number');
        expect(() => validateEnv({ MISSING: String })).toThrow('Missing required field: MISSING');
        expect(process.exit).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it.each([['', 0], [' ', 0], ['Infinity', Infinity], ['-Infinity', -Infinity], ['0x10', 16]] as const)(
        'preserves existing numeric conversion for %j', (input, expected) => {
            expect(validateEnv({ VALUE: { type: Number, strict: false } }, { VALUE: input }).VALUE).toBe(expected);
        });

    it('preserves an empty string as a present string value', () => {
        expect(validateEnv({ VALUE: String }, { VALUE: '' })).toEqual({ VALUE: '' });
    });

    it('throws catchable errors in a real host process', () => {
        const fixture = directory();
        const script = path.join(fixture, 'host.cts');
        fs.writeFileSync(script, `import { strict as assert } from 'node:assert';
import { validateEnv } from ${JSON.stringify(path.resolve(__dirname, '../src/index.ts'))};
let caught = false;
try { validateEnv({ MISSING: String }); }
catch (error) { assert.match((error as Error).message, /Missing required field: MISSING/); caught = true; }
assert.equal(caught, true);
`);
        const result = spawnSync(process.execPath, ['--require', require.resolve('tsx/cjs'), script], {
            cwd: fixture, env: {}, encoding: 'utf8', timeout: 15000,
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr })
            .toEqual({ status: 0, stdout: '', stderr: '' });
    });
});

describe('sources', () => {
    it('uses an explicit object alone without reading files or changing either source', () => {
        process.env = { PORT: '1111', HOST: 'process-only' };
        fs.writeFileSync(path.join(process.cwd(), '.env'), 'PORT=3333\nHOST=file-only\n');
        const read = jest.spyOn(fs, 'readFileSync');
        const config = Object.freeze({ PORT: '2222' });
        expect(validateEnv({ PORT: Number, HOST: { type: String, required: false } }, config))
            .toEqual({ PORT: 2222 });
        expect(config).toEqual({ PORT: '2222' });
        expect(process.env).toEqual({ PORT: '1111', HOST: 'process-only' });
        expect(read).not.toHaveBeenCalled();
    });

    it('defaults to process.env without reading an existing .env or resolving cwd', () => {
        fs.writeFileSync(path.join(process.cwd(), '.env'), 'PORT=3000\nDEBUG=false\n');
        process.env.PORT = '9000';
        const read = jest.spyOn(fs, 'readFileSync');
        jest.spyOn(process, 'cwd').mockImplementation(() => { throw new Error('unexpected cwd'); });
        expect(validateEnv({ PORT: Number })).toEqual({ PORT: 9000 });
        expect(validateEnv({ PORT: Number }, undefined)).toEqual({ PORT: 9000 });
        expect(() => validateEnv({ PORT: Number, DEBUG: Boolean })).toThrow('Missing required field: DEBUG');
        expect(process.env).toEqual({ PORT: '9000' });
        expect(read).not.toHaveBeenCalled();
    });

    it('rejects removed filename and third-argument forms without reading files or exposing paths', () => {
        const read = jest.spyOn(fs, 'readFileSync');
        for (const args of [[{}, 'PRIVATE_PATH'], [{}, {}, 'PRIVATE_PATH'], [{}, undefined, undefined]]) {
            try {
                Reflect.apply(validateEnv, undefined, args);
                throw new Error('expected contract failure');
            } catch (error) {
                expect(error).toBeInstanceOf(EnvValidationError);
                expect((error as EnvValidationError).issues).toEqual([{ code: 'invalid_config', message: expect.any(String) }]);
                expect((error as Error).message).not.toContain('PRIVATE_PATH');
            }
        }
        expect(read).not.toHaveBeenCalled();
    });

    it.each([null, [], true, 1, 'PRIVATE_PATH'] as const)('rejects invalid configuration roots: %p', config => {
        expect(() => validateEnv({}, config as unknown as Record<string, unknown>)).toThrow(/configuration must be an object/);
    });
});

describe('schemas and object keys', () => {
    it.each([
        { VALUE: null }, { VALUE: [] }, { VALUE: Date }, { VALUE: { type: Date, required: false } },
        { VALUE: { type: Number, required: 'false' } },
        { VALUE: { type: Number, required: false, default: 'oops' } },
        { VALUE: { type: Number, default: NaN } },
        { VALUE: { type: Boolean, default: 'false' } },
        { VALUE: { type: String, default: 1 } },
    ])('rejects invalid definitions even when input is present: %p', schema => {
        expect(() => validateEnv(schema as unknown as EnvSchema, { VALUE: 'present' })).toThrow(/VALUE/);
    });

    it.each([null, [], 1] as const)('rejects invalid schema roots: %p', schema => {
        expect(() => validateEnv(schema as unknown as EnvSchema, {})).toThrow(/schema must be an object/);
    });

    it('does not inherit field options or source values', () => {
        const inheritedOptions = Object.create({ type: String }) as unknown;
        expect(() => validateEnv({ VALUE: inheritedOptions } as EnvSchema, {})).toThrow(/unsupported type/);
        const inheritedSource = Object.create({ VALUE: 'inherited' }) as Record<string, unknown>;
        expect(() => validateEnv({ VALUE: String }, inheritedSource)).toThrow('Missing required field: VALUE');
    });

    it.each(['constructor', 'toString', '__proto__'])('safely handles %s', key => {
        const schema = Object.fromEntries([[key, String]]);
        expect(() => validateEnv(schema, {})).toThrow(`Missing required field: ${key}`);
        const result = validateEnv(schema, Object.fromEntries([[key, 'value']]));
        expect(Object.prototype.hasOwnProperty.call(result, key)).toBe(true);
        expect(result[key]).toBe('value');
        expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    });

    it('validates non-enumerable schema fields and rejects symbol keys', () => {
        const schema = Object.defineProperty({}, 'VALUE', { value: String }) as EnvSchema;
        expect(validateEnv(schema, { VALUE: 'value' })).toEqual({ VALUE: 'value' });
        expect(() => validateEnv({ [Symbol('VALUE')]: String }, {})).toThrow(/keys must be strings/);
    });
});
