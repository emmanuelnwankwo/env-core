import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { EnvSchema } from './types';

const validateEnv = (schema: EnvSchema, envFile: string = '.env'): Record<string, any> => {
    const envPath = path.resolve(process.cwd(), envFile);
    if (!fs.existsSync(envPath)) {
        throw new Error(`Environment file not found: ${envPath}`);
    }

    try {
        const result = dotenv.config({ path: envPath });
        if (result.error) {
            throw result.error;
        }
    } catch (error) {
        throw new Error('dotenv package is missing in your project. If installed, ensure it is configured correctly.');
    }

    const envConfig: Record<string, any> = process.env;
    const missingFields: string[] = [];
    const wrongTypes: string[] = [];

    Object.keys(schema).forEach((key) => {
        const expectedType = schema[key];
        const envValue = envConfig[key];

        if (!envValue) {
            missingFields.push(key);
            return;
        }

        // Validate types
        if (expectedType === Number && isNaN(Number(envValue))) {
            wrongTypes.push(`${key} should be a number`);
        } else if (expectedType === Boolean && envValue !== 'true' && envValue !== 'false') {
            wrongTypes.push(`${key} should be a boolean`);
        } else if (expectedType === String && typeof envValue !== 'string') {
            wrongTypes.push(`${key} should be a string`);
        }
    });

    if (missingFields.length || wrongTypes.length) {
        const errorMessage = `Environment validation failed:\n` +
            (missingFields.length ? `Missing fields: ${missingFields.join(', ')}\n` : '') +
            (wrongTypes.length ? `Wrong types: ${wrongTypes.join(', ')}` : '');

        throw new Error(errorMessage);
    }

    return envConfig;
};

export { validateEnv }