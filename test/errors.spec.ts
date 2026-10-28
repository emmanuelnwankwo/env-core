import { expect, it } from '@jest/globals';
import { EnvValidationError, validateEnv } from '../src/index';
import type { EnvIssue, EnvIssueCode, EnvSchema } from '../src/index';

function failure(schema: EnvSchema, config: Record<string, unknown>): EnvValidationError {
    try { validateEnv(schema, config); }
    catch (error) {
        if (error instanceof EnvValidationError) return error;
        throw error;
    }
    throw new Error('expected validation failure');
}

it('aggregates stable, value-free issues while retaining Error compatibility and messages', () => {
    const error = failure({ MISSING: String, PORT: Number, BAD: { type: Number, default: 'SECRET' } } as unknown as EnvSchema,
        { PORT: 'SECRET' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EnvValidationError');
    expect(error.issues).toEqual([
        { code: 'missing_required', key: 'MISSING', message: 'Missing required field: MISSING' },
        { code: 'invalid_value', key: 'PORT', message: 'PORT should be a finite decimal number' },
        { code: 'invalid_schema', key: 'BAD', message: 'BAD has an invalid default' },
    ]);
    expect(error.message).toBe('Environment validation failed:\n- Missing required field: MISSING\n- PORT should be a finite decimal number\n- BAD has an invalid default');
    expect(JSON.stringify(error)).not.toContain('SECRET');
    expect(error).not.toHaveProperty('data');
});

it('reports root failures without inventing a field key', () => {
    for (const [schema, config, code] of [
        [null, {}, 'invalid_schema'],
        [{ [Symbol('PORT')]: Number }, {}, 'invalid_schema'],
        [{}, [], 'invalid_config'],
    ] as const) {
        const error = failure(schema as unknown as EnvSchema, config as unknown as Record<string, unknown>);
        expect(error.issues).toEqual([{ code, message: expect.any(String) }]);
    }
});

it('escapes control characters in display messages while preserving the machine-readable key', () => {
    const key = 'TOKEN\n\u001b[31m';
    const error = failure({ [key]: Number }, { [key]: 'SECRET' });
    expect(error.issues[0].key).toBe(key);
    expect(error.message).toContain('TOKEN\\n\\u001b[31m');
    expect(error.message.split('\n')).toHaveLength(2);
    expect(error.message).not.toContain('SECRET');
});

it('takes an immutable snapshot of caller-provided issues', () => {
    const code: EnvIssueCode = 'missing_required';
    const issues: EnvIssue[] = [{ code, key: '', message: 'missing' }];
    const error = new EnvValidationError(issues);
    issues[0] = { code: 'invalid_type', message: 'changed' };
    issues.push({ code, message: 'later' });
    expect(error.issues).toEqual([{ code, key: '', message: 'missing' }]);
    expect(Reflect.set(error.issues[0], 'message', 'changed')).toBe(false);
    expect(Object.isFrozen(error.issues)).toBe(true);
});
