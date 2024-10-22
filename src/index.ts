import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { ValidatedEnv, EnvSchema, EnvSchemaItem } from './types';

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
const validateEnv = <T extends EnvSchema>(schema: T, envFile?: string): ValidatedEnv<T> => {
    const fileToLoad = envFile || '.env';
    let env: NodeJS.ProcessEnv = process.env;

    const envPath = path.resolve(process.cwd(), fileToLoad); // Resolve the path of the environment file

    if (fs.existsSync(envPath)) {
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            console.error(`Error loading ${fileToLoad}: ${result.error.message}`);
        } else {
            env = { ...process.env, ...result.parsed }; // Merge existing process.env with loaded env variables
        }
    }

    const envConfig = {} as ValidatedEnv<T>;
    const errors: string[] = [];

    for (const [key, schemaValue] of Object.entries(schema)) {
        const schemaItem: EnvSchemaItem<any> = typeof schemaValue === 'function'
            ? { type: schemaValue, required: true }
            : { ...schemaValue, required: schemaValue.required !== false };

        const envValue = env[key];

        if (envValue === undefined) {
            if (schemaItem.required) {
                errors.push(`Missing required field: ${key}`);
            } else if ('default' in schemaItem) {
                envConfig[key as keyof T] = schemaItem.default;
            }
            continue;
        }

        switch (schemaItem.type) {
            case Number:
                const num = Number(envValue);
                if (isNaN(num)) {
                    errors.push(`${key} should be a number`);
                } else {
                    envConfig[key as keyof T] = num as any;
                }
                break;
            case Boolean:
                if (envValue !== 'true' && envValue !== 'false') {
                    errors.push(`${key} should be a boolean`);
                } else {
                    envConfig[key as keyof T] = (envValue === 'true') as any;
                }
                break;
            case String:
                envConfig[key as keyof T] = envValue as any;
                break;
            default:
                errors.push(`${key} has an unsupported type`);
        }
    }

    if (errors.length) {
        console.error('Environment validation failed:');
        errors.forEach(error => { console.error(`- ${error}`); });
        process.exit(1);
    }

    return envConfig;
};

export { validateEnv };
