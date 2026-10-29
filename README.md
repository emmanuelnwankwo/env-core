# Env Core

`env-core` is a lightweight, type-safe environment variable validation library for Node.js projects.

<p align="center">
  <a href="https://github.com/emmanuelnwankwo/env-core/actions/workflows/node.js.yml?query=branch%3Amain"><img src="https://github.com/emmanuelnwankwo/env-core/actions/workflows/node.js.yml/badge.svg?event=push&amp;branch=main" alt="Tests" /></a>
  <a href="https://www.npmjs.com/package/env-core"><img src="https://img.shields.io/npm/dw/env-core.svg" alt="Weekly npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/github/license/emmanuelnwankwo/env-core" alt="MIT license" /></a>
</p>

## Features
- Type-safe environment variable validation
- Supports `String`, `Number`, and `Boolean` types
- Optional variables with default values
- Detailed error messages for validation failures
- Compatible with Express.js, NestJS, and other Node.js frameworks
- Minimal dependencies
- Works with both ESM (`import`) and CommonJS (`require`)

## Installation

```sh
# npm
npm install env-core

# pnpm
pnpm add env-core

# yarn
yarn add env-core

# deno
deno add jsr:@nec/env-core
```

The JSR package is [`@nec/env-core`](https://jsr.io/@nec/env-core).

This README describes the v2.0 contract. See the [v2.0 migration guide](https://github.com/emmanuelnwankwo/env-core/blob/main/MIGRATION.md) or the [v1.3.0 documentation](https://github.com/emmanuelnwankwo/env-core/blob/v1.3.0/README.md) when using v1.x.

From 1.3.0, ESM imports use a native `.mjs` entry with matching declarations. It shares the CommonJS runtime, so functions and `EnvValidationError` retain their identity when both module formats are used together.

## Quickstart

Save this as `env.mts`. With Node 22.18+, run `node env.mts` after installation; on older Node versions, compile it with your project's TypeScript setup first.

```typescript
import { EnvValidationError, validateEnv } from 'env-core';

const schema = {
  PORT: { type: Number, strict: true, integer: true, min: 1, max: 65535 },
  DEBUG: { type: Boolean, default: false },
  API_TOKEN: { type: String, minLength: 1, sensitive: true },
} as const;

export function readConfig(config: Record<string, unknown>) {
  try {
    return validateEnv(schema, config);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      const issues = error.issues.map(({ code, key }) => ({ code, key }));
      throw new Error('Invalid environment configuration: ' + JSON.stringify(issues));
    }
    throw error;
  }
}

const env = readConfig({ PORT: '3000', API_TOKEN: 'example-only' });
const port: number = env.PORT;
const debug: boolean = env.DEBUG;
```

The example returns typed values and reports only error codes and field names on failure. At application startup, replace the sample object with `readConfig(process.env)`. An explicit object is the sole source; it does not load files or modify `process.env`. Without an explicit object, `validateEnv(schema)` validates only process values. For file fallbacks, pass the result of `loadEnv({ files: ['.env'] })`; listed files must exist.

See [file layering](#file-layering), [safe templates](#environment-templates), [CLI commands](#cli), and the [Express](#expressjs)/[NestJS](#nestjs) examples for other entry points.

## Usage
### Define the Environment Schema
First, define a schema for your environment variables. Here are three different use cases for how you can set up your `envSchema`:
#### Use Case 1: Simple Types
Environment variables are defined using simple types without additional options.
```javascript
// src/envSchema.js

export const envSchema = {
  PORT: Number,
  NODE_ENV: String,
  DEBUG: Boolean,
  HOST: String,
};
```

#### Use Case 2: Configuration Options
You can include default values and exclude requirement check for specific environment variables.
```javascript
// src/envSchema.js

export const envSchema = {
  DEBUG: { 
    type: Boolean,
    default: false,
  },
  HOST: {
    type: String,
    default: '0.0.0.0',
    required: false,
  },
};
```

#### Use Case 3: Mixed Configuration
You use a mix of simple types and configuration options for both flexibility and control.
```javascript
// src/envSchema.js

export const envSchema = {
  PORT: Number,
  NODE_ENV: String,
  DEBUG: {
    type: Boolean,
    default: false,
  },
  HOST: {
    type: String,
    default: '0.0.0.0',
    required: false,
  },
};
```

### EnvSchema Format
The `envSchema` object defines the structure and validation rules for your environment variables. Each key in the object represents an environment variable, and the value defines its type and optional settings.

| Format | Description | Example |
|--------|-------------|---------|
| `KEY: Type` | Simple type definition (required by default) | `PORT: Number` |
| `KEY: { type: Type, default: value }` | Type with default value (optional) | `DEBUG: { type: Boolean, default: false }` |
| `KEY: { type: Type, required: boolean }` | Explicitly set if required | `NODE_ENV: { type: String, required: false }` |

Supported types: `String`, `Number`, `Boolean`

A valid default makes a field optional unless `required: true` is explicit. Defaults must match their constructor and are validated even when input is present. `default: undefined` behaves like no default. Missing values and `undefined` are distinct from empty strings and `null`; empty strings remain present values, while `null` is invalid.

### Strict parsing

Number fields accept only finite numbers or decimal strings by default, including signs, fractions, and exponent notation. Blank strings, whitespace, hex/binary/octal notation, `NaN`, and `Infinity` are rejected. JavaScript number precision still applies. Numeric defaults must also be finite. Set `strict: false` explicitly to retain JavaScript number conversion, including blank strings converting to zero and unconstrained infinities. Constraints still apply.

Boolean fields, with or without `strict: true`, accept only typed booleans and the exact strings `'true'` and `'false'`; `0`, `1`, case variants, and whitespace are invalid. Missing fields continue to follow `required` and `default`; String fields accept empty strings and do not support `strict`.

### Constraints

Constraints run after conversion and also apply to defaults, even when input is present. Missing optional fields are skipped. Invalid definitions, contradictory bounds, and defaults that violate constraints produce `invalid_schema` issues.

| Option | Applies to | Behavior |
| --- | --- | --- |
| `min`, `max` | Number | Inclusive finite bounds; constrained values must be finite |
| `integer: true` | Number | Requires a safe integer |
| `minLength`, `maxLength` | String | Inclusive nonnegative integer bounds on JavaScript string length (UTF-16 code units) |
| `pattern` | String | A RegExp; caller state is preserved, including global/sticky patterns |
| `choices` | Any field | A nonempty readonly array matching the field's primitive type; compares converted values |

For example: `{ PORT: { type: Number, strict: true, integer: true, min: 1, max: 65535 }, MODE: { type: String, choices: ['dev', 'prod'] } }`.

### Custom validators and sensitive fields

Add a synchronous `validate(value)` callback to check the converted primitive after built-in rules pass. Return `true` to accept, `false` for a generic failure, or a string for a custom failure message. Defaults are checked too, even when input is present; missing optional fields skip the callback. Validators should be pure, since both a declared default and a supplied value may be checked in one call.

```typescript
import type { EnvSchemaItem } from 'env-core';

const port: EnvSchemaItem<number> = {
  type: Number,
  strict: true,
  validate: value => value % 2 === 0 || 'must be even',
};

const schema = {
  PORT: port,
  TOKEN: { type: String, sensitive: true, validate: (value: string) => value.startsWith('svc_') },
};
```

`EnvSchemaItem<T>` provides contextual callback typing; annotate the callback parameter when using an inline field. The root also exports `EnvValidator<T>`. Callbacks receive the constructor's primitive type, not a default's literal type. Async callbacks and other invalid results produce `invalid_validator`; thrown errors are converted without exposing their message or cause.

Set `sensitive: true` to suppress custom failure messages and mark that field's issues with `sensitive: true`. Built-in issues already omit input values, patterns, and choice lists. Custom messages for non-sensitive fields are retained with control characters escaped. Successful configuration values are returned unchanged.

## Usage Examples

### Express.js
Call the `validateEnv` function with your schema to validate the environment variables before starting your server.
```javascript
// src/index.js

import express from 'express';
import { validateEnv } from 'env-core';
import { envSchema } from './envSchema.js'; // Import the validation schema

// Validate the environment variables using the schema
const env = validateEnv(envSchema); // validates process values only

const app = express();

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(env.PORT, () => {
    console.log(`Server is running on port ${env.PORT}`);
});
```
If any environment variable is missing or has the wrong type, the app will not start, and a detailed error message will be displayed.

### NestJS
`env-core` can be integrated into a NestJS project to validate environment variables during the module initialization process. 

```typescript
// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'env-core';
import { envSchema } from './envSchema.js'; // Import the validation schema

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => validateEnv(envSchema, config), // Validate environment variables
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```
If the validation fails, NestJS will not initialize, and a descriptive error message will be printed.

## API Reference
`validateEnv<T extends EnvSchema>(schema: T, config?: Record<string, unknown>): ValidatedEnv<T>`

- schema: An object that defines the required environment variables and their types. Supported types are String, Number, and Boolean.
- `config` (optional): The sole configuration source, including already typed numbers and booleans. Defaults to `process.env`. No other values or files are merged into an explicit object.

Validation never loads files or changes `process.env`. Use `loadEnv` for explicit file loading. Filename and third-argument calls are rejected with `invalid_config`; TypeScript also rejects those removed forms.

#### Returns
A fresh mutable configuration object containing schema fields only. Missing optional fields are omitted and their inferred types include `undefined`. Readonly schemas do not make returned values readonly. Defaults and choices do not narrow the constructor's returned primitive type. If validation fails, an error is thrown.

The package root also exports the types `EnvSchema`, `EnvSchemaItem<T>`, and `ValidatedEnv<T>`.

### File layering

Requires 1.3.0 or later.

Use `loadEnv` to select explicit sources, then pass its result to `validateEnv`:

```typescript
import { loadEnv, validateEnv } from 'env-core';

const env = validateEnv({ PORT: Number }, loadEnv({
  files: ['.env', '.env.local'],
}));
```

Files load in order; later files win. Process values win by default; `override: true` lets file values win instead. Every listed file must be readable, including `.env` when explicitly listed. Relative paths resolve from the current working directory. No files load implicitly through `loadEnv`; `files: []` snapshots only the process source.

`processEnv` supplies an alternative source, including typed values; pass `{}` for files only. The result is a fresh record with no prototype. Sources and `process.env` remain unchanged. The root exports the `EnvSourceOptions` type.

### Environment templates

Requires 1.3.0 or later.

`generateEnvExample(schema)` returns a string of blank assignments such as `PORT=\nTOKEN=\n`, ready to save as `.env.example`. It includes own string field names in schema order, including non-enumerable fields. It never reads field definitions, defaults, current values, or validator callbacks, so even unmarked secret defaults are omitted.

Names must start with a letter or underscore and contain only letters, digits, and underscores. Invalid names and symbol keys throw `EnvValidationError`; an empty schema produces an empty string. Nonempty output ends with a newline. This function lists names; `validateEnv` checks field definitions and values.

### CLI

Requires 1.3.0 or later.

Export a schema as a module default or named `envSchema` export. For CommonJS, use `module.exports = schema`.

```typescript
// env.schema.mts
import type { EnvSchema } from 'env-core';

export default {
  PORT: { type: Number, strict: true, integer: true, min: 1, max: 65535 },
  TOKEN: { type: String, sensitive: true },
} satisfies EnvSchema;
```

```sh
npx env-core check --schema ./env.schema.mts --file .env --file .env.local --json
npx env-core example --schema ./env.schema.mts > .env.example
```

Direct `.ts`, `.mts`, and `.cts` schemas use Node 22.18+ native type stripping. Use erasable TypeScript syntax and explicit type-only imports; Node does not type-check schemas or apply `tsconfig` transforms, path aliases, enums, or decorators. `.ts` follows the project's module type, `.mts` is ESM, and `.cts` is CommonJS. JavaScript `.js`/`.mjs`/`.cjs` schemas, including compiled TypeScript, work on Node 16+. Schema modules execute as ordinary code.

`check` reads process values and only files explicitly passed with repeated `--file` flags, in order. Process values win unless `--override` is set. Use `--no-process-env` for files only. Relative schema and file paths resolve from the current working directory. The CLI uses `--file` to avoid Node's own `--env-file` handling.

Exit codes are `0` for success, `1` for validation errors, and `2` for usage or loading failures. `--json` writes `{ "success": true }` or a failure result to stdout. Validation failures include issue codes, keys, and sensitive markers; operational failures include an error code and safe message. Human failures go to stderr. Neither format prints values, custom validator messages, or exception causes. Codes for operational failures are `invalid_arguments`, `schema_load_failed`, `source_load_failed`, and `validation_failed`.

`example` writes the same blank assignments as `generateEnvExample`; it does not read environment files. Use `--help` for options. No TypeScript loader or argument-parser dependency is installed, and library imports do not load the CLI.

## Error Handling
Validation failures throw the exported `EnvValidationError`, which extends `Error`. Its readonly `issues` array contains `{ code, key?, message, sensitive?: true }` entries. Built-in messages contain no input values. Codes are `invalid_schema`, `invalid_config`, `missing_required`, `invalid_type`, and `invalid_value` (strict numeric parsing); root errors have no field key. File-loading errors remain separate errors with their native `cause`.

Constraint failures use `too_small`, `too_big`, `not_integer`, `invalid_pattern`, and `invalid_choice`. Numeric constraints also use `invalid_value` for non-finite numbers. Messages do not include the input, pattern, or allowed choices.

Custom rule failures use `custom_validation`; thrown errors and invalid or asynchronous results use `invalid_validator`. Invalid custom defaults use `invalid_schema`.

If validation fails, the package throws an error with detailed information, including:
- Missing required environment variables
- Environment variables with incorrect types

#### Example Error Message:
```yml
Environment validation failed:
- Missing required field: NODE_ENV
- DEBUG should be a boolean
```

### Example of .env or custom env file
```bash
PORT=3000
NODE_ENV=development
DEBUG=true
```

## Contributing
Feel free to submit issues or pull requests if you find bugs or have ideas for improvements.

## License
This package is licensed under the MIT License.
