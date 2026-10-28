import { expect, it } from '@jest/globals';
import { EnvValidationError, validateEnv } from '../src/index';
import type { EnvSchema } from '../src/index';

it.each(['0', '+0', '-0', '01', '-12', '1.5', '.5', '1.', '1e3', '-2E-3', 0, -1.25, 1e20])(
    'accepts strict finite decimal input %p', input => {
        for (const field of [Number, { type: Number }, { type: Number, strict: true }]) {
            expect(validateEnv({ VALUE: field }, { VALUE: input }).VALUE).toBe(Number(input));
        }
    });

it.each(['', ' ', '\n', ' 1', '1 ', '1\n', '1\r\n', '1\u2028', '0x10', '0b10', '0o10', 'Infinity', '-Infinity', 'NaN', '1e309', '1_000', '1x', '1e', NaN, Infinity, -Infinity])(
    'rejects strict numeric input %p with a value issue', input => {
        for (const field of [Number, { type: Number }, { type: Number, strict: true }]) {
            expect(() => validateEnv({ VALUE: field }, { VALUE: input }))
                .toThrow(expect.objectContaining({ issues: [{ code: 'invalid_value', key: 'VALUE', message: expect.stringContaining('finite decimal') }] }));
        }
    });

it.each([true, false, 'true', 'false'])(
    'accepts exact strict boolean input %p', input => {
        expect(validateEnv({ VALUE: { type: Boolean, strict: true } }, { VALUE: input }).VALUE)
            .toBe(input === true || input === 'true');
    });

it.each([0, 1, '0', '1', 'TRUE', 'False', ' false', 'true\n', null, {}, []])(
    'rejects coercive strict boolean input %p', input => {
        expect(() => validateEnv({ VALUE: { type: Boolean, strict: true } }, { VALUE: input })).toThrow(EnvValidationError);
    });

it('preserves legacy parsing and handles strict defaults and missing fields', () => {
    expect(validateEnv({ VALUE: { type: Number, strict: false } }, { VALUE: '0x10' }).VALUE).toBe(16);
    expect(validateEnv({ VALUE: { type: Number, strict: false, default: Infinity } }, {})).toEqual({ VALUE: Infinity });
    for (const value of [NaN, 'invalid']) {
        expect(() => validateEnv({ VALUE: { type: Number, strict: false } }, { VALUE: value }))
            .toThrow(expect.objectContaining({ issues: [{ code: 'invalid_type', key: 'VALUE', message: expect.any(String) }] }));
    }
    expect(validateEnv({ VALUE: { type: Number, strict: true, default: 0 } }, {})).toEqual({ VALUE: 0 });
    expect(validateEnv({ VALUE: { type: Boolean, strict: true, default: false } }, {})).toEqual({ VALUE: false });
    expect(validateEnv({ VALUE: { type: Number, strict: true, required: false } }, {})).toEqual({});
    expect(() => validateEnv({ VALUE: { type: Number, strict: true } }, {})).toThrow('Missing required field');
    expect(() => validateEnv({ VALUE: { type: Number, strict: true } }, { VALUE: true })).toThrow('should be a number');
});

it.each([
    { type: Number, default: Infinity },
    { type: Number, default: NaN },
    { type: Number, strict: true, default: Infinity },
    { type: Number, strict: true, default: NaN },
    { type: Number, strict: 'true' },
    { type: String, strict: false },
])('rejects invalid strict definitions before using supplied input: %p', field => {
    expect(() => validateEnv({ VALUE: field } as unknown as EnvSchema, { VALUE: 1 }))
        .toThrow(expect.objectContaining({ issues: [{ code: 'invalid_schema', key: 'VALUE', message: expect.any(String) }] }));
});
