// import { EnvSchema } from './types';

// export default function validateEnv(schema: EnvSchema) {
//     return (envConfig: Record<string, any> = process.env): Record<string, any> => {
//         const missingFields: string[] = [];
//         const wrongTypes: string[] = [];

//         Object.keys(schema).forEach((key) => {
//             const expectedType = schema[key];
//             const envValue = envConfig[key];

//             if (!envValue) {
//                 missingFields.push(key);
//                 return;
//             }

//             // Validate types
//             if (expectedType === Number && isNaN(Number(envValue))) {
//                 wrongTypes.push(`${key} should be a number`);
//             } else if (expectedType === Boolean && envValue !== 'true' && envValue !== 'false') {
//                 wrongTypes.push(`${key} should be a boolean`);
//             }
//         });

//         if (missingFields.length || wrongTypes.length) {
//             const errorMessage = `Environment validation failed:\n` +
//                 (missingFields.length ? `Missing fields: ${missingFields.join(', ')}\n` : '') +
//                 (wrongTypes.length ? `Wrong types: ${wrongTypes.join(', ')}` : '');

//             throw new Error(errorMessage);
//         }

//         return envConfig; // Return validated config
//     };
// }

// import { EnvSchema } from './types';

// export default function validateEnv(schema: EnvSchema | { new (): EnvSchema }) {
//     // Check if schema is a class constructor and instantiate it if necessary
//     const schemaInstance = typeof schema === 'function' ? new schema() : schema;

//     return (envConfig: Record<string, any> = process.env): Record<string, any> => {
//         const missingFields: string[] = [];
//         const wrongTypes: string[] = [];

//         Object.keys(schemaInstance).forEach((key) => {
//             const expectedType = schemaInstance[key];
//             const envValue = envConfig[key];

//             if (envValue === undefined || envValue === null || envValue === '') {
//                 missingFields.push(key);
//                 return;
//             }

//             // Validate types
//             if (expectedType === Number && isNaN(Number(envValue))) {
//                 wrongTypes.push(`${key} should be a number`);
//             } else if (expectedType === Boolean && envValue !== 'true' && envValue !== 'false') {
//                 wrongTypes.push(`${key} should be a boolean`);
//             }
//         });

//         if (missingFields.length || wrongTypes.length) {
//             const errorMessage = `Environment validation failed:\n` +
//                 (missingFields.length ? `Missing fields: ${missingFields.join(', ')}\n` : '') +
//                 (wrongTypes.length ? `Wrong types: ${wrongTypes.join(', ')}` : '');

//             throw new Error(errorMessage);
//         }

//         return envConfig; // Return validated config
//     };
// }

// interface EnvSchemaInt {
//     PORT: number;
//     NODE_ENV: string;
//     DEBUG: boolean;

// }
// class EnvSchemaClass implements EnvSchemaInt {
//     PORT!: number;
//     NODE_ENV!: string;
//     DEBUG!: boolean;
// }

// const validate = validateEnv(EnvSchemaClass);


// type SchemaType = typeof String | typeof Number | typeof Boolean;

// type EnvSchema<T extends Record<string, any> = Record<string, SchemaType>> = {
//   [K in keyof T]: SchemaType;
// };

// export default function validateEnv<T extends Record<string, any>>(
//   schema: EnvSchema<T> | T
// ) {
//   return (envConfig: Partial<T> = process.env as any): T => {
//     const missingFields: string[] = [];
//     const wrongTypes: string[] = [];

//     const schemaEntries = Object.entries(schema);

//     for (const [key, expectedType] of schemaEntries) {
//       const envValue = envConfig[key as keyof T];

//       if (envValue === undefined) {
//         missingFields.push(key);
//         continue;
//       }

//       // Validate types
//       if (expectedType === Number && isNaN(Number(envValue))) {
//         wrongTypes.push(`${key} should be a number`);
//       } else if (expectedType === Boolean && envValue !== 'true' && envValue !== 'false') {
//         wrongTypes.push(`${key} should be a boolean`);
//       } else if (expectedType === String && typeof envValue !== 'string') {
//         wrongTypes.push(`${key} should be a string`);
//       }
//     }

//     if (missingFields.length || wrongTypes.length) {
//       const errorMessage = `Environment validation failed:\n` +
//         (missingFields.length ? `Missing fields: ${missingFields.join(', ')}\n` : '') +
//         (wrongTypes.length ? `Wrong types: ${wrongTypes.join(', ')}` : '');

//       throw new Error(errorMessage);
//     }

//     return envConfig as T;
//   };
// }

// Example usage:
// const envSchema = {
//     PORT: Number,
//     NODE_ENV: String,
//     DEBUG: Boolean,
// };

// class EnvSchemaClass {
//     PORT!: number;
//     NODE_ENV!: string;
//     DEBUG!: boolean;
// }

// const validateConstObject = validateEnv(envSchema);
// // validateConstObject[0]
// const validateClassObject = validateEnv(EnvSchemaClass);
// validateClassObject
