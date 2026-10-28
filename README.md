# Env Core

`env-core` is a lightweight, type-safe environment variable validation library for Node.js projects.

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
npm install env-core
```

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

Set `strict: true` on a Number field to accept only finite numbers or decimal strings, including signs, fractions, and exponent notation: `{ type: Number, strict: true }`. Blank strings, whitespace, hex/binary/octal notation, `NaN`, and `Infinity` are rejected. JavaScript number precision still applies. Numeric defaults must also be finite in strict mode. Existing Number fields retain their current conversion unless they opt in.

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

## Usage Examples

### Express.js
Call the `validateEnv` function with your schema to validate the environment variables before starting your server.
```javascript
// src/index.js

import express from 'express';
import { validateEnv } from 'env-core';
import { envSchema } from './envSchema.js'; // Import the validation schema

// Validate the environment variables using the schema
const env = validateEnv(envSchema); // Option 1: Validates using environment variables or defaults to .env
// const env = validateEnv(envSchema, 'test.env'); // Option 2: Validates using a custom env file

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
`validateEnv(schema: EnvSchema, envPath?: string)`

`validateEnv(schema: EnvSchema, config: Record<string, unknown>, envPath?: string)`

- schema: An object that defines the required environment variables and their types. Supported types are String, Number, and Boolean.
- `envPath` (optional): A string specifying a custom .env file to load (e.g., 'test.env').
- `config`: An explicit configuration object used as the sole source, including already typed numbers and booleans. No file or process values are merged into it; a third file argument is ignored.

Without `config`, existing process values take precedence over file values. A missing default `.env` is allowed; missing explicit files and file read errors throw. Validation leaves `process.env` unchanged.

#### Returns
The validated configuration object, containing schema fields only. Missing optional fields are omitted and their inferred types include `undefined`. If validation fails, an error is thrown.

The package root also exports the types `EnvSchema`, `EnvSchemaItem<T>`, and `ValidatedEnv<T>`.

## Error Handling
Validation failures throw the exported `EnvValidationError`, which extends `Error`. Its readonly `issues` array contains `{ code, key?, message }` entries without input values. Codes are `invalid_schema`, `invalid_config`, `missing_required`, `invalid_type`, and `invalid_value` (strict numeric parsing); root errors have no field key. File-loading errors remain separate errors with their native `cause`.

Constraint failures use `too_small`, `too_big`, `not_integer`, `invalid_pattern`, and `invalid_choice`. Numeric constraints also use `invalid_value` for non-finite numbers. Messages do not include the input, pattern, or allowed choices.

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
