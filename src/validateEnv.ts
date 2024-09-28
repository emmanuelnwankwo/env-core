import { EnvSchema } from './types';

function validateEnv(schema: EnvSchema): void {
    const missingFields: string[] = [];
    const wrongTypes: string[] = [];

    Object.keys(schema).forEach((key) => {
        const expectedType = schema[key];
        const envValue = NodeJS.process.env[key];

        if (!envValue) {
            missingFields.push(key);
            return;
        }

        if (expectedType === Number && isNaN(Number(envValue))) {
            wrongTypes.push(`${key} should be a number`);
        } else if (expectedType === Boolean && envValue !== 'true' && envValue !== 'false') {
            wrongTypes.push(`${key} should be a boolean`);
        }
    });

    if (missingFields.length || wrongTypes.length) {
        console.error(`Environment validation failed:`);

        if (missingFields.length) {
            console.error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        if (wrongTypes.length) {
            console.error(`Incorrect data types: ${wrongTypes.join(', ')}`);
        }

        // Prevent the server from starting
        NodeJS.process.exit(1);
    }
}

export default validateEnv;
