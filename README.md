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
Install `env-core` package:
```bash
npm install env-core
```
Since the package relies on environment variables, you should also have the dotenv package installed in your project:
```bash
npm install dotenv
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

## Integration Examples

### Express.js Integration
Call the `validateEnv` function with your schema to validate the environment variables before starting your server.
```javascript
// src/index.js

import express from 'express';
import { validateEnv } from 'env-core';
import { envSchema } from './envSchema.js'; // Import the validation schema
import 'dotenv/config';

// Validate the environment variables using the schema
const env = validateEnv(envSchema); // Option 1: Validates using .env
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

### NestJS Integration (*Upcoming feature - currently does not work with ConfigModule)
`env-core` can be integrated into a NestJS project to validate environment variables during the module initialization process. 

```typescript
// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'env-core';
import 'dotenv/config';
import { envSchema } from './envSchema.js'; // Import the validation schema

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv(envSchema), // Validate environment variables
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
- schema: An object that defines the required environment variables and their types. Supported types are String, Number, and Boolean.
- `envPath` (optional): A string specifying a custom .env file to load (e.g., 'test.env'). Defaults to .env.

#### Returns
A function that takes the envConfig (defaults to process.env) and validates it against the schema. If validation passes, the function returns the validated config. If validation fails, an error is thrown.

## Error Handling
If validation fails, the package throws an error with detailed information, including:
- Missing required environment variables
- Environment variables with incorrect types

### Example Error Message:
```yml
Environment validation failed:
- Missing required field: NODE_ENV
- Missing required field: DEBUG
- DEBUG should be a boolean
```

## Example of .env or custom env file
```bash
PORT=3000
NODE_ENV=development
DEBUG=true
```

## Contributing
Feel free to submit issues or pull requests if you find bugs or have ideas for improvements.

## License
This package is licensed under the MIT License.