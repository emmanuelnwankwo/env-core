import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { validateEnv } from '../src/index';
import type { EnvSchema } from '../src/types';

const originalEnv = process.env;
const fixtures: string[] = [];

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
            .toThrow('VALUE should be a number');
        expect(validateEnv({ VALUE: { type: Number, default: 10 } }, { VALUE: '20' })).toEqual({ VALUE: 20 });
    });

    it('aggregates errors without logging, exiting, or exposing values', () => {
        expect(() => validateEnv({ MISSING: String, VALUE: Number }, { VALUE: 'TOP_SECRET' }))
            .toThrow('Environment validation failed:\n- Missing required field: MISSING\n- VALUE should be a number');
        expect(() => validateEnv({ MISSING: String })).toThrow('Missing required field: MISSING');
        expect(process.exit).not.toHaveBeenCalled();
        expect(console.error).not.toHaveBeenCalled();
    });

    it.each([['', 0], [' ', 0], ['Infinity', Infinity], ['-Infinity', -Infinity], ['0x10', 16]] as const)(
        'preserves existing numeric conversion for %j', (input, expected) => {
            expect(validateEnv({ VALUE: Number }, { VALUE: input }).VALUE).toBe(expected);
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
    it('uses explicit configuration alone and ignores the legacy file argument', () => {
        process.env.PORT = '1111';
        process.env.HOST = 'process-only';
        const envFile = file('PORT=3333\nHOST=file-only\nUNDECLARED=value\n');
        expect(validateEnv({ PORT: Number, HOST: { type: String, required: false } }, { PORT: '2222' }, envFile))
            .toEqual({ PORT: 2222 });
        expect(process.env.UNDECLARED).toBeUndefined();
        expect(validateEnv({ PORT: Number }, { PORT: '2222' }, path.join(directory(), 'missing')))
            .toEqual({ PORT: 2222 });
    });

    it('loads the default file with process values taking precedence', () => {
        const envFile = file('PORT=3000\nDEBUG=false\nUNDECLARED=value\n');
        jest.spyOn(process, 'cwd').mockReturnValue(path.dirname(envFile));
        process.env.PORT = '9000';
        expect(validateEnv({ PORT: Number, DEBUG: Boolean })).toEqual({ PORT: 9000, DEBUG: false });
        expect(process.env).toEqual({ PORT: '9000' });
    });

    it('leaves the process unchanged on validation failure', () => {
        const envFile = file('PORT=3000\nUNDECLARED=value\n');
        expect(() => validateEnv({ MISSING: String }, envFile)).toThrow('Missing required field: MISSING');
        expect(process.env).toEqual({});
    });

    it('isolates repeated file reads and does not inject defaults', () => {
        const first = file('PORT=3000\n');
        const second = file('PORT=4000\n');
        expect(validateEnv({ PORT: Number }, first)).toEqual({ PORT: 3000 });
        expect(validateEnv({ PORT: Number }, second)).toEqual({ PORT: 4000 });
        expect(validateEnv({ DEBUG: { type: Boolean, default: false } }, {})).toEqual({ DEBUG: false });
        expect(process.env).toEqual({});
    });

    it('allows a missing implicit file and an explicitly selected empty file', () => {
        jest.spyOn(process, 'cwd').mockReturnValue(directory());
        process.env.PORT = '9000';
        expect(validateEnv({ PORT: Number })).toEqual({ PORT: 9000 });
        expect(validateEnv({ PORT: Number }, file(''))).toEqual({ PORT: 9000 });
    });

    it('does not let process values conceal an explicit missing file or read error', () => {
        process.env.PORT = '9000';
        expect(() => validateEnv({ PORT: Number }, path.join(directory(), 'missing.env'))).toThrow(expect.objectContaining({
            message: expect.stringContaining('ENOENT'),
            cause: expect.objectContaining({ code: 'ENOENT' }),
        }));
        expect(() => validateEnv({ PORT: Number }, directory())).toThrow(/EISDIR/);
        expect(console.error).not.toHaveBeenCalled();
    });

    it('only ignores missing implicit files, not other read errors', () => {
        const fixture = directory();
        fs.mkdirSync(path.join(fixture, '.env'));
        jest.spyOn(process, 'cwd').mockReturnValue(fixture);
        expect(() => validateEnv({}, undefined)).toThrow(/EISDIR/);
    });

    it.each([null, [], true, 1] as const)('rejects invalid configuration roots: %p', config => {
        expect(() => validateEnv({}, config as unknown as Record<string, unknown>)).toThrow(/configuration must be an object/);
    });

    it('rejects non-string file paths from untyped callers', () => {
        expect(() => Reflect.apply(validateEnv, undefined, [{}, undefined, 123])).toThrow(/file path must be a string/);
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
