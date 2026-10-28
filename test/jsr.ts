import assert from 'node:assert/strict';
import { EnvValidationError, generateEnvExample, loadEnv, validateEnv } from '../src/index.ts';
import type { EnvSchema, EnvSchemaItem, ValidatedEnv } from '../src/types.ts';

const schema = { PORT: Number, DEBUG: { type: Boolean, default: false } } satisfies EnvSchema;
const values: ValidatedEnv<typeof schema> = validateEnv(schema, { PORT: '3210' });
assert.equal(values.PORT, 3210);
assert.equal(values.DEBUG, false);
assert.equal(generateEnvExample({ TOKEN: { type: String, default: 'PRIVATE_TOKEN' } }), 'TOKEN=\n');
assert.equal(validateEnv({ PORT: Number }, loadEnv({ files: [], processEnv: { PORT: '3210' } })).PORT, 3210);
assert.equal(validateEnv({ PORT: { type: Number, validate: (value: number) => value > 0 } }, { PORT: '3210' }).PORT, 3210);
assert.equal(validateEnv({ PORT: { type: Number, min: 1, max: 65535, integer: true } }, { PORT: '3210' }).PORT, 3210);
assert.equal(validateEnv({ PORT: { type: Number, strict: true } }, { PORT: '3e2' }).PORT, 300);
assert.throws(() => validateEnv({ PORT: { type: Number, strict: true } }, { PORT: ' ' }), EnvValidationError);
assert.throws(() => validateEnv({ PORT: Number }, { PORT: 'invalid' }), EnvValidationError);
assert.throws(() => validateEnv({ PORT: Number }, { PORT: '0x10' }), EnvValidationError);
assert.equal(validateEnv({ PORT: { type: Number, strict: false } }, { PORT: '0x10' }).PORT, 16);
const booleanChoices: EnvSchemaItem<boolean> = { type: Boolean, choices: [true, false] };
const stringChoices: EnvSchemaItem<'dev' | 'prod'> = { type: String, choices: ['dev', 'prod'] };
assert.deepEqual(validateEnv({ FLAG: booleanChoices, MODE: stringChoices }, { FLAG: 'false', MODE: 'prod' }),
    { FLAG: false, MODE: 'prod' });
const mutable = validateEnv({ PORT: { type: Number, default: 1 } } as const, {});
mutable.PORT = 2;
assert.equal(mutable.PORT, 2);
