import { expect, it } from '@jest/globals';
import { EnvValidationError, validateEnv } from '../src/index';
import type { EnvSchema } from '../src/index';

function codes(schema: EnvSchema, config: Record<string, unknown>): string[] {
    try { validateEnv(schema, config); }
    catch (error) {
        if (error instanceof EnvValidationError) return error.issues.map(issue => issue.code);
        throw error;
    }
    throw new Error('expected validation failure');
}

it('accepts inclusive bounds, safe integers, typed choices and zero-length strings', () => {
    const schema = {
        PORT: { type: Number, min: 0, max: 65535, integer: true },
        NAME: { type: String, minLength: 0, maxLength: 2, pattern: /^.*$/ },
        MODE: { type: String, choices: ['dev', 'prod'] },
        ENABLED: { type: Boolean, choices: [false] },
    } satisfies EnvSchema;
    expect(validateEnv(schema, { PORT: '0', NAME: '', MODE: 'dev', ENABLED: 'false' }))
        .toEqual({ PORT: 0, NAME: '', MODE: 'dev', ENABLED: false });
    expect(validateEnv(schema, { PORT: 65535, NAME: '🙂', MODE: 'prod', ENABLED: false }).PORT).toBe(65535);
    expect(validateEnv({ VALUE: { type: Number, choices: [1, 2] } }, { VALUE: '2' }).VALUE).toBe(2);
    expect(validateEnv({ VALUE: { type: Number, integer: false } }, { VALUE: 1.5 }).VALUE).toBe(1.5);
});

it('aggregates constraint issues deterministically without exposing values or choices', () => {
    const schema = {
        NUMBER: { type: Number, min: 0, integer: true, choices: [1, 2] },
        LONG: { type: String, maxLength: 2, pattern: /^ok$/ },
        SHORT: { type: String, minLength: 1 },
        BIG: { type: Number, max: 0 },
    } satisfies EnvSchema;
    expect(codes(schema, { NUMBER: -1.5, LONG: 'SECRET', SHORT: '', BIG: 1 }))
        .toEqual(['too_small', 'not_integer', 'invalid_choice', 'too_big', 'invalid_pattern', 'too_small', 'too_big']);
});

it.each([Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe constrained numbers %p', value => {
    expect(codes({ VALUE: { type: Number, integer: true } }, { VALUE: value }))
        .toEqual([Number.isFinite(value) ? 'not_integer' : 'invalid_value']);
});

it('checks defaults against constraints even when input is present and skips absent optional fields', () => {
    for (const field of [
        { type: Number, default: 1, min: 2 },
        { type: Number, default: Infinity, max: 5 },
        { type: String, default: '', minLength: 1 },
        { type: String, default: 'bad', pattern: /^ok$/ },
        { type: Boolean, default: false, choices: [true] },
    ]) expect(codes({ VALUE: field }, { VALUE: 'present' })).toEqual(['invalid_schema']);
    expect(validateEnv({ VALUE: { type: Number, default: 0, min: 0, integer: true } }, {})).toEqual({ VALUE: 0 });
    expect(validateEnv({ VALUE: { type: String, required: false, minLength: 1 } }, {})).toEqual({});
    const inherited = Object.assign(Object.create({ min: 10 }) as object, { type: Number });
    expect(validateEnv({ VALUE: inherited }, { VALUE: 0 })).toEqual({ VALUE: 0 });
});

it.each([
    { type: Number, min: NaN }, { type: Number, max: Infinity }, { type: Number, min: '0' },
    { type: Number, min: 1, max: 0 }, { type: String, minLength: 2, maxLength: 1 },
    { type: String, minLength: -1 }, { type: String, maxLength: 1.5 },
    { type: String, min: 0 }, { type: Number, maxLength: 2 },
    { type: String, integer: false }, { type: Number, integer: 'true' },
    { type: Number, pattern: /x/ }, { type: String, pattern: 'x' },
    { type: String, choices: [] }, { type: String, choices: new Array(1) },
    { type: Number, choices: [NaN] }, { type: Number, choices: ['1'] },
    { type: Boolean, choices: ['true'] }, { type: String, choices: 'x' },
])('rejects malformed constraints even for absent optional fields: %p', field => {
    expect(codes({ VALUE: { ...field, required: false } } as unknown as EnvSchema, {})).toEqual(['invalid_schema']);
});

it.each(['g', 'y'])('preserves caller regex state and resets %s patterns between defaults and calls', flags => {
    const pattern = new RegExp('^ok$', flags);
    pattern.lastIndex = 7;
    Object.freeze(pattern);
    const schema = { VALUE: { type: String, pattern, default: 'ok' } } satisfies EnvSchema;
    expect(validateEnv(schema, { VALUE: 'ok' })).toEqual({ VALUE: 'ok' });
    expect(validateEnv(schema, {})).toEqual({ VALUE: 'ok' });
    expect(codes(schema, { VALUE: 'bad' })).toEqual(['invalid_pattern']);
    expect(pattern.lastIndex).toBe(7);
});
