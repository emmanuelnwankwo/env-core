import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { ValidatedEnv, EnvSchema, EnvSchemaItem } from './types';


/**
 * The function `loadEnvFile` loads environment variables from a specified file using dotenv in a
 * TypeScript environment.
 * @param {string} [envFile=.env] - The `envFile` parameter is a string that represents the file path
 * of the environment file to be loaded. By default, it is set to `'.env'`, which is a common filename
 * used for environment configuration files in Node.js applications.
 * @returns `NodeJS.ProcessEnv` object, which contains the
 * environment variables loaded from the specified `.env` file or the existing process environment
 * variables if the file does not exist.
 */
const loadEnvFile = (envFile: string = '.env'): NodeJS.ProcessEnv => {
    let env: NodeJS.ProcessEnv = process.env;
    const envPath = path.resolve(process.cwd(), envFile);

    if (fs.existsSync(envPath)) {
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            console.error(`Error loading ${envFile}: ${result.error.message}`);
        } else {
            env = { ...process.env, ...result.parsed };
        }
    }

    return env;
};

/**
 * The function `validateEnvVariable` checks and validates environment variables based on a specified
 * schema and returns the value or undefined along with any errors encountered.
 * @param {string} key - The `key` parameter is a string representing the name of the environment
 * variable being validated.
 * @param {string | undefined} envValue - The `envValue` parameter is the value of the environment
 * variable corresponding to the provided key. It can be a string or undefined if the environment
 * variable is not set.
 * @param schemaItem - The `schemaItem` parameter in the `validateEnvVariable` function is of type
 * `EnvSchemaItem<T>`. This type represents the schema definition for an environment variable. It
 * contains information such as the type of the variable (Number, Boolean, String)
 * @param {string[]} errors - The `errors` parameter is an array that stores error messages encountered
 * during the validation process. If any validation errors occur, they are pushed into this array to be
 * handled or displayed later.
 * @returns  Validated environment variable value of type `T` or `undefined` based on 
 * the provided key, environment value, schema item, and errors array.
 */
const validateEnvVariable = <T>(key: string, envValue: string | undefined, schemaItem: EnvSchemaItem<T>, errors: string[]): T | undefined => {
    if (envValue === undefined) {
        if (schemaItem.required) {
            errors.push(`Missing required field: ${key}`);
        } else if ('default' in schemaItem) {
            return schemaItem.default;
        }
        return;
    }

    switch (schemaItem.type) {
        case Number:
            {
                const num = Number(envValue);
                if (isNaN(num)) {
                    errors.push(`${key} should be a number`);
                } else {
                    return num as T;
                }
                break;
            }
        case Boolean:
            if (envValue !== 'true' && envValue !== 'false') {
                errors.push(`${key} should be a boolean`);
            } else {
                return (envValue === 'true') as T;
            }
            break;
        case String:
            return envValue as T;
        default:
            errors.push(`${key} has an unsupported type`);
    }
};

/**
 * Validates and loads environment variables based on a provided schema.
 * 
 * @template T - The type of the environment schema.
 * @param {T} schema - An object describing the expected environment variables and their types.
 *                     Each key in the schema can be either a constructor (String, Number, Boolean)
 *                     or an object with `type`, `required`, and `default` properties.
 * @param {string} [envFile] - The name of the environment file to load. Defaults to '.env' if not provided.
 * 
 * @returns {ValidatedEnv<T>} An object containing the validated environment variables.
 * 
 * @example
 * const env = validateEnv({
 *   PORT: Number,
 *   NODE_ENV: String,
 *   DEBUG: { type: Boolean, default: false }
 * });
 * 
 */
function validateEnv<T extends EnvSchema>(schema: T, envFile?: string): ValidatedEnv<T>;
/**
 * Validates and loads environment variables based on a provided schema.
 * 
 * @template T - The type of the environment schema.
 * @param {T} schema - An object describing the expected environment variables and their types.
 *                     Each key in the schema can be either a constructor (String, Number, Boolean)
 *                     or an object with `type`, `required`, and `default` properties.
 * @param {Record<string, any>} [config] - A configuration object containing environment variables for NestJS
 * @param {string} [envFile] - The name of the environment file to load. Defaults to '.env' if not provided.
 * 
 * @throws {Error} Throws an error if required environment variables are missing or if any validation fails.
 * 
 * @example
 * ConfigModule.forRoot({
 *   isGlobal: true,
 *   validate: (config) => validateEnv(envSchema, config),
 * }),
 * 
 */
function validateEnv<T extends EnvSchema>(schema: T, config: Record<string, any>, envFile?: string): ValidatedEnv<T>;

function validateEnv<T extends EnvSchema>(schema: T, configOrEnvFile?: Record<string, any> | string, envFile?: string): ValidatedEnv<T> {
    envFile = (typeof configOrEnvFile === 'string') ? configOrEnvFile : envFile;
    const env: NodeJS.ProcessEnv = loadEnvFile(envFile);
    const envConfig = {} as ValidatedEnv<T>;
    const errors: string[] = [];

    for (const [key, schemaValue] of Object.entries(schema)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const schemaItem: EnvSchemaItem<any> = typeof schemaValue === 'function'
            ? { type: schemaValue, required: true }
            : { ...schemaValue, required: schemaValue.required !== false };

        const envValue = env[key];

        const validatedValue = validateEnvVariable(key, envValue, schemaItem, errors);
        if (validatedValue !== undefined) {
            envConfig[key as keyof T] = validatedValue;
        }
    }

    if (errors.length) {
        if (typeof configOrEnvFile === 'object') {
            const formattedErrors = errors.map(error => `- ${error}`).join('\n');
            throw new Error(`Environment validation failed:\n${formattedErrors}`);
        } else {
            console.error('Environment validation failed:');
            errors.forEach(error => { console.error(`- ${error}`); });
            process.exit(1);
        }
    }

    return envConfig;
};

export { validateEnv };
