# env-core

`env-core` is a lightweight, type-safe environment variable validation library for Node.js projects. It ensures that your environment variables match the expected schema and types, providing robust validation for both JavaScript and TypeScript projects.

## Features
- Type-safe environment variable validation
- Supports `String`, `Number`, and `Boolean` types.
- Optional variables with default values
- Detailed error messages for validation failures
- Compatible with Express.js, NestJS, and other Node.js frameworks
- Minimal dependencies.

## Installation
First, install the env-core package:
```bash
npm install env-core
```
Since the package relies on environment variables, you should also have the dotenv package installed in your project:
```bash
npm install dotenv
```
Ensure you load your environment variables from `.env` before using the validator.

## Usage
### 1. Using `env-core` in an Express.js project
Here’s an example of how to integrate env-core into an Express.js project:

#### Step 1: Define the validation schema
Define a schema for the environment variables and pass it to the validateEnv function. The schema specifies the expected type for each variable (Number, String, Boolean).

#### Step 2: Call `validateEnv` during server setup
Ensure the environment variables are validated before the Express server starts.

```javascript
// src/index.js

const express = require('express');
const { validateEnv } = require('env-core'); // Import the env-core
require('dotenv').config(); // Load environment variables from .env file

// Define the schema for the required environment variables
const envSchema = {
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

// Validate the environment variable
const env = validateEnv(envSchema);
// test.env overrides .env file path
// const env = validateEnv(envSchema, 'test.env');

const app = express();

app.get('/', (req, res) => {
    res.send('Hello World!');
});

// Use env output
app.listen(env.PORT, () => {
    console.log(`Server is running on port ${env.PORT}`);
});

```

Example `.env` File
```bash
PORT=3000
NODE_ENV=development
DEBUG=true
```

If any environment variable is missing or has the wrong type, the app will not start, and a detailed error message will be displayed.

### 2. Using env-core in a NestJS project
In a **NestJS** project, you can integrate the `validateEnv` function into the `ConfigModule` by passing it to the `validate` option in `ConfigModule.forRoot()`.

#### Step 1: Define the validation schema
Define the schema for the environment variables in your app.module.ts.

#### Step 2: Pass `validateEnv` to `ConfigModule.forRoot()`
NestJS allows for environment variable validation during module initialization.

```typescript
// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'env-core'; // Import the env-core
require('dotenv').config(); // Load environment variables from .env file

const envSchema = {
  PORT: Number,
  NODE_ENV: String,
  DEBUG: Boolean,
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Make the config globally available
      envFilePath: process.env.NODE_ENV === 'test' ? 'test.env' : '.env',
      validate: validateEnv(envSchema), // Pass the validateEnv function
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
```
Example `.env` File
```bash
PORT=3000
NODE_ENV=development
DEBUG=true
```
If the validation fails, NestJS will not initialize, and a descriptive error message will be printed.

## API Reference
`validateEnv(schema: EnvSchema)`
- schema: An object that defines the required environment variables and their types. Supported types are String, Number, and Boolean.
#### Returns
A function that takes the envConfig (defaults to process.env) and validates it against the schema. If validation passes, the function returns the validated config. If validation fails, an error is thrown.

## Error Handling
If a required environment variable is missing or has an incorrect type, the package will throw an error with a detailed message listing:

- The missing environment variables.
- Variables with incorrect types.

#### Example Error Message:
```yml
Environment validation failed:
- Missing required field: NODE_ENV
- Missing required field: DEBUG
- DEBUG should be a boolean
```

## Contributing
Feel free to submit issues or pull requests if you find bugs or have ideas for improvements.

## License
This package is licensed under the MIT License.