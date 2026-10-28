import { inspect } from 'node:util';
import { expect, it, jest } from '@jest/globals';
import { EnvValidationError, validateEnv } from '../src/index';
import type { EnvSchema, EnvSchemaItem, EnvValidator } from '../src/index';

function failure(schema: EnvSchema, config: Record<string, unknown>): EnvValidationError {
    try { validateEnv(schema, config); }
    catch (error) {
        if (error instanceof EnvValidationError) return error;
        throw error;
    }
    throw new Error('expected validation failure');
}

it('runs typed synchronous validators on converted values and defaults', () => {
    const validate = jest.fn<EnvValidator<number>>(value => value % 2 === 0);
    const field: EnvSchemaItem<number> = { type: Number, validate, default: 2 };
    expect(validateEnv({ VALUE: field }, {})).toEqual({ VALUE: 2 });
    expect(validate.mock.calls).toEqual([[2]]);
    validate.mockClear();
    expect(validateEnv({ VALUE: field }, { VALUE: '4' })).toEqual({ VALUE: 4 });
    expect(validate.mock.calls).toEqual([[2], [4]]);
    const boolean: EnvSchemaItem<boolean> = { type: Boolean, validate: value => value === false };
    expect(validateEnv({ VALUE: boolean }, { VALUE: 'false' })).toEqual({ VALUE: false });
});

it('skips callbacks for missing optional fields, parse failures and failed built-in constraints', () => {
    const validate = jest.fn<EnvValidator<number>>(() => true);
    expect(validateEnv({ VALUE: { type: Number, validate, required: false } }, {})).toEqual({});
    expect(failure({ VALUE: { type: Number, validate } }, { VALUE: 'bad' }).issues[0].code).toBe('invalid_value');
    expect(failure({ VALUE: { type: Number, validate, min: 0 } }, { VALUE: -1 }).issues[0].code).toBe('too_small');
    expect(validate).not.toHaveBeenCalled();
});

it('aggregates custom failures and escapes display messages without logging or leaking thrown errors', () => {
    const error = failure({
        FIRST: { type: String, validate: () => false },
        SECOND: { type: String, validate: () => 'use a different\nvalue' },
        THIRD: { type: String, validate: () => { throw new Error('SECRET'); } },
    }, { FIRST: 'one', SECOND: 'two', THIRD: 'three' });
    expect(error.issues.map(issue => issue.code)).toEqual(['custom_validation', 'custom_validation', 'invalid_validator']);
    expect(error.issues[1].message).toBe('SECOND: use a different\\nvalue');
    expect(error.message.split('\n')).toHaveLength(4);
    expect(inspect(error)).not.toContain('SECRET');
    expect(error).not.toHaveProperty('cause');
    expect(failure({ VALUE: { type: String, validate: () => '' } }, { VALUE: '' }).issues[0].message)
        .toBe('VALUE failed custom validation');
});

it.each([null, undefined, 0, {}])('rejects invalid validator results %p', result => {
    const schema = { VALUE: { type: String, validate: () => result } } as unknown as EnvSchema;
    expect(failure(schema, { VALUE: 'secret' }).issues[0].code).toBe('invalid_validator');
});

it('rejects promises and thenables without unhandled rejections', async () => {
    const secret = 'PRIVATE_ASYNC_ERROR';
    for (const validate of [
        () => Promise.resolve(true),
        async () => { throw new Error(secret); },
        () => ({ then: () => { throw new Error(secret); } }),
    ]) {
        const error = failure({ VALUE: { type: String, validate } } as unknown as EnvSchema, { VALUE: secret });
        expect(error.issues[0].code).toBe('invalid_validator');
        expect(inspect(error)).not.toContain(secret);
    }
    await new Promise(resolve => setImmediate(resolve));
});

it('checks custom defaults and option definitions even when a field is absent or input is present', () => {
    expect(failure({ VALUE: { type: Number, default: 3, validate: () => false } }, { VALUE: 2 }).issues[0].code)
        .toBe('invalid_schema');
    const validate = jest.fn<EnvValidator<number>>(() => true);
    expect(failure({ VALUE: { type: Number, default: -1, min: 0, validate } }, {}).issues[0].code).toBe('invalid_schema');
    expect(validate).not.toHaveBeenCalled();
    for (const options of [{ validate: true }, { sensitive: 'true' }]) {
        expect(failure({ VALUE: { type: String, required: false, ...options } } as unknown as EnvSchema, {}).issues[0].code)
            .toBe('invalid_schema');
    }
    const inherited = Object.assign(Object.create({ validate: () => false, sensitive: true }) as object, { type: String });
    expect(validateEnv({ VALUE: inherited }, { VALUE: 'ok' })).toEqual({ VALUE: 'ok' });
});

it('redacts custom messages and marks every sensitive issue while preserving valid secret values', () => {
    const secret = 'TOP_SECRET_VALUE';
    const error = failure({
        TOKEN: { type: String, sensitive: true, validate: (value: string) => `invalid token ${value}` },
        NUMBER: { type: Number, sensitive: true },
        MISSING: { type: String, sensitive: true },
        DEFAULT: { type: String, sensitive: true, default: secret, validate: () => secret },
        BAD: { type: String, sensitive: true, min: secret },
    } as unknown as EnvSchema, { TOKEN: secret, NUMBER: secret });
    expect(error.issues.map(issue => issue.code))
        .toEqual(['custom_validation', 'invalid_value', 'missing_required', 'invalid_schema', 'invalid_schema']);
    expect(error.issues.every(issue => issue.sensitive === true)).toBe(true);
    for (const text of [error.message, error.stack, JSON.stringify(error), inspect(error)]) expect(text).not.toContain(secret);
    expect(validateEnv({ TOKEN: { type: String, sensitive: true, validate: () => true } }, { TOKEN: secret })).toEqual({ TOKEN: secret });
    expect(failure({ TOKEN: { type: String, sensitive: false, validate: () => 'explanation' } }, { TOKEN: secret }).issues[0])
        .toEqual({ code: 'custom_validation', key: 'TOKEN', message: 'TOKEN: explanation' });
});
