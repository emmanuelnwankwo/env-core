import assert from 'node:assert/strict';
import { EnvValidationError, validateEnv } from '../src/index.ts';
import type { EnvSchema, ValidatedEnv } from '../src/types.ts';

const schema = { PORT: Number, DEBUG: { type: Boolean, default: false } } satisfies EnvSchema;
const values: ValidatedEnv<typeof schema> = validateEnv(schema, { PORT: '3210' });
assert.equal(values.PORT, 3210);
assert.equal(values.DEBUG, false);
assert.equal(validateEnv({ PORT: { type: Number, validate: (value: number) => value > 0 } }, { PORT: '3210' }).PORT, 3210);
assert.equal(validateEnv({ PORT: { type: Number, min: 1, max: 65535, integer: true } }, { PORT: '3210' }).PORT, 3210);
assert.equal(validateEnv({ PORT: { type: Number, strict: true } }, { PORT: '3e2' }).PORT, 300);
assert.throws(() => validateEnv({ PORT: { type: Number, strict: true } }, { PORT: ' ' }), EnvValidationError);
assert.throws(() => validateEnv({ PORT: Number }, { PORT: 'invalid' }), EnvValidationError);
