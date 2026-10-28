# Migrating to env-core v2.0

This guide describes the v2.0 contract. The published v1.3 release keeps its existing behavior until you upgrade. The explicit loading patterns below already work in v1.3, so applications can migrate before adopting v2.0.

## Separate loading from validation

The validation interface is `validateEnv(schema, config = process.env)`. An explicit object is the sole source. Omitting it validates only `process.env`; validation no longer reads an implicit `.env` file. Validation never changes its input or `process.env`.

Replace filename calls such as `validateEnv(schema, 'test.env')` with an explicit loader:

```typescript
import { loadEnv, validateEnv } from 'env-core';

const schema = { PORT: Number, DEBUG: { type: Boolean, default: false } } as const;
const env = validateEnv(schema, loadEnv({ files: ['test.env'] }));
const port: number = env.PORT;
```

If an application previously relied on the implicit `.env`, pass `files: ['.env']` to `loadEnv`. Every listed file must be readable: a missing explicitly listed `.env` throws. To use only process values, call `validateEnv(schema)`; to use only supplied values, call `validateEnv(schema, config)`.

The filename overload and ignored third argument are removed. `validateEnv(schema, config, filename)` must become `validateEnv(schema, config)`. TypeScript rejects the old forms; untyped callers receive an `invalid_config` issue rather than silently retaining ignored arguments. An invalid configuration root remains an error.

## Make source precedence explicit

`loadEnv` retains the v1.3 source options. Files load in order and later files win. Process values win over files unless `override: true` is selected. Use `processEnv: {}` for files only, or supply an independent object containing strings or typed primitives. `files: []` snapshots only that source. Relative paths resolve from the current working directory.

```typescript
import { loadEnv, validateEnv } from 'env-core';

const env = validateEnv({ PORT: Number }, loadEnv({
  files: ['.env', '.env.local'],
  processEnv: {},
}));
const port: number = env.PORT;
```

No file is optional or loaded implicitly. Loader failures remain separate errors with their original cause. `loadEnv` returns a fresh record without a prototype and never mutates any source. `validateEnv` returns a fresh ordinary object containing only validated schema fields.

## Number parsing is strict by default

Both `PORT: Number` and `PORT: { type: Number }` accept finite typed numbers or decimal strings, including signs, fractions and exponent notation. Blank strings, surrounding whitespace, hexadecimal/binary/octal strings, `NaN` and infinities are rejected. Invalid numeric text now produces `invalid_value`, matching explicit strict parsing in v1.3; unrelated input types produce `invalid_type`. JavaScript number precision still applies.

Use an explicit escape hatch only where existing inputs require JavaScript number conversion:

```typescript
import { validateEnv } from 'env-core';

const env = validateEnv({ MASK: { type: Number, strict: false } }, { MASK: '0x10' });
const mask: number = env.MASK;
```

`strict: false` permits the v1 conversion rules, including blank strings converting to zero and unconstrained infinities. Constraints may still reject those results. Numeric defaults must be finite unless that field explicitly sets `strict: false`; defaults remain typed values and are never coerced.

Booleans still accept only typed booleans or the exact strings `'true'` and `'false'`. The Boolean `strict` flag does not enable coercion. String fields still require strings and accept empty strings unless constrained; they do not support `strict`.

## Missing values and defaults

Only an absent own property or `undefined` is missing. `null` is invalid; an empty string is present. Supplied invalid values never fall back to defaults. Inherited input properties are ignored.

| Field definition | Missing input |
| --- | --- |
| Constructor or `{ type }` | `missing_required` |
| `{ type, required: false }` | Field omitted |
| `{ type, default: value }` | Validated default returned |
| `{ type, required: false, default: value }` | Validated default returned |
| `{ type, required: true, default: value }` | `missing_required` |
| `{ type, default: undefined }` | Behaves as no default |

Every defined default is checked even when input is supplied. Default failures are `invalid_schema`. Synchronous custom validators run after built-in checks; missing optional fields skip them. Successful values remain unchanged by `sensitive: true`, which suppresses custom failure messages. Catch `EnvValidationError` and report issue codes and keys when values or custom messages must not be exposed.

## TypeScript contract

Use `as const satisfies EnvSchema` when retaining field-presence flags in a reusable schema. Successful values follow the constructor: `String` gives `string`, `Number` gives `number`, and `Boolean` gives `boolean`. Defaults and choices do not narrow the returned primitive to a literal. Missing optional fields include `undefined`; widened definitions conservatively retain that possibility when presence cannot be established.

`EnvSchemaItem<T>` keeps defaults and choices within `T` while callbacks receive the constructor's full primitive type. Homogeneous literal unions, including Boolean choices, work as one field definition. Returned configuration is mutable even when the schema is readonly; no runtime immutability is implied by `as const` on a schema.

Optional field/source options explicitly set to `undefined` are treated as unset, including when TypeScript's `exactOptionalPropertyTypes` is enabled. A defined `default` still determines whether a missing optional value can be returned.

The root exports `EnvSchema`, `EnvSchemaItem`, `EnvValidator`, `ValidatedEnv`, `EnvSourceOptions`, `EnvIssue` and `EnvIssueCode`. CommonJS and native ESM share the same validation functions and `EnvValidationError` class.

## Application and CLI integration

Frameworks that already provide a configuration object can keep passing it directly. For example, NestJS can retain `validate: config => validateEnv(schema, config)` in `ConfigModule.forRoot`. An Express application can validate `process.env` or explicit `loadEnv` output before listening. Neither integration needs a second implicit loader.

The npm CLI already uses explicit file loading. Keep repeated `--file` flags, `--override` and `--no-process-env` as needed; Number fields now use the same strict default as the library. `check` and `example` retain their value-free output and exit codes. JavaScript schemas work on Node 16+; direct erasable TypeScript schemas require Node 22.18+ native type stripping. No new runtime dependency is required.
