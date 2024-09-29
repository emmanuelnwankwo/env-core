# env-validation

`env-validator` is a lightweight, framework-agnostic environment variable validation library for Node.js projects. It ensures that the environment variables in your .env file match the expected schema and types. The package supports both JavaScript and TypeScript projects, and works seamlessly with Express.js and NestJS.

# Features
- Validates environment variables based on a schema you define.
- Supports types like `String`, `Number`, and `Boolean`.
- Throws user-friendly errors if validation fails, preventing the app from starting.
- Works with both Express.js and NestJS projects.
- Minimal dependencies.

# Installation
First, install the env-validator package:
```bash
npm install env-validator
```
Since the package relies on environment variables, you should also have the dotenv package installed in your project:
```bash
npm install dotenv
```
Ensure you load your environment variables from `.env` before using the validator.

# Usage
### 1. Using `env-validator` in an Express.js project
Here’s an example of how to integrate env-validator into an Express.js project:

#### Step 1: Define the validation schema
Define a schema for the environment variables and pass it to the validateEnv function. The schema specifies the expected type for each variable (Number, String, Boolean).

#### Step 2: Call `validateEnv` during server setup
Ensure the environment variables are validated before the Express server starts.

```javascript
// src/index.js

const express = require('express');
const { validateEnv } = require('env-validator'); // Import the validator
require('dotenv').config(); // Load environment variables from .env file

// Define the schema for the required environment variables
const envSchema = {
    PORT: Number,
    NODE_ENV: String,
    DEBUG: Boolean,
};

// Validate the environment variables
validateEnv(envSchema);

const app = express();

app.get('/', (req, res) => {
    res.send('Hello World!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

```

Example `.env` File
```bash
PORT=3000
NODE_ENV=development
DEBUG=true
```

If any environment variable is missing or has the wrong type, the app will not start, and a detailed error message will be displayed.

### 2. Using env-validator in a NestJS project
In a **NestJS** project, you can integrate the `validateEnv` function into the `ConfigModule` by passing it to the `validate` option in `ConfigModule.forRoot()`.

#### Step 1: Define the validation schema
Define the schema for the environment variables in your app.module.ts.

#### Step 2: Pass `validateEnv` to `ConfigModule.forRoot()`
NestJS allows for environment variable validation during module initialization.

```typescript
// src/app.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from 'env-validator'; // Import the validator
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
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
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

# API Reference
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
Missing fields: PORT
Wrong types: DEBUG should be a boolean
```

# Contributing
Feel free to submit issues or pull requests if you find bugs or have ideas for improvements.

# License
This package is licensed under the MIT License.