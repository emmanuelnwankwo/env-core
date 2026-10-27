import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import type { EnvSchema, EnvValue, SchemaType, ValidatedEnv } from './types';

interface NormalizedItem {
    type: SchemaType;
    required: boolean;
    default: EnvValue | undefined;
}

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaType(value: unknown): value is SchemaType {
    return value === String || value === Number || value === Boolean;
}

/** loads file fallbacks without mutating the process environment */
function loadEnvFile(envFile?: unknown): Record<string, unknown> {
    if (envFile !== undefined && typeof envFile !== 'string') throw new Error('Environment file path must be a string');
    const envPath = path.resolve(process.cwd(), envFile ?? '.env');
    let parsed: Record<string, string>;
    try {
        parsed = dotenv.parse(fs.readFileSync(envPath));
    } catch (error) {
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
        if (envFile === undefined && code === 'ENOENT') return { ...process.env };
        throw Object.defineProperty(new Error(`Unable to load environment file ${envPath} (${code})`),
            'cause', { value: error, configurable: true, writable: true });
    }
    return { ...parsed, ...process.env };
}

/** checks defaults without coercing their declared primitive type */
function validDefault(value: unknown, type: SchemaType): value is EnvValue {
    return type === String ? typeof value === 'string'
        : type === Number ? typeof value === 'number' && !Number.isNaN(value)
        : typeof value === 'boolean';
}

/** validates field definitions before applying missing-value rules */
function normalizeItem(key: string, value: unknown, errors: string[]): NormalizedItem | undefined {
    const item = isRecord(value) ? value : { type: value };
    const type = hasOwn(item, 'type') ? item.type : undefined;
    if (!isSchemaType(type)) {
        errors.push(`${key} has an unsupported type`);
        return;
    }
    const required = hasOwn(item, 'required') ? item.required : undefined;
    if (required !== undefined && typeof required !== 'boolean') {
        errors.push(`${key} required must be a boolean`);
        return;
    }
    const fallback = hasOwn(item, 'default') ? item.default : undefined;
    if (fallback !== undefined && !validDefault(fallback, type)) {
        errors.push(`${key} has an invalid default`);
        return;
    }
    return {
        type,
        required: required === true || (required !== false && fallback === undefined),
        default: fallback,
    };
}

/** converts present values while keeping raw input out of errors */
function convertValue(key: string, value: unknown, type: SchemaType, errors: string[]): EnvValue | undefined {
    switch (type) {
        case String:
            if (typeof value === 'string') return value;
            errors.push(`${key} should be a string`);
            break;
        case Number:
            if (typeof value === 'string' || typeof value === 'number') {
                const number = Number(value);
                if (!Number.isNaN(number)) return number;
            }
            errors.push(`${key} should be a number`);
            break;
        case Boolean:
            if (typeof value === 'boolean') return value;
            if (value === 'true' || value === 'false') return value === 'true';
            errors.push(`${key} should be a boolean`);
    }
}

/** validates process values with optional file fallbacks */
function validateEnv<T extends EnvSchema>(schema: T, envFile?: string): ValidatedEnv<T>;
/** validates explicit configuration without consulting files or process values */
function validateEnv<T extends EnvSchema>(schema: T, config: Record<string, unknown>, envFile?: string): ValidatedEnv<T>;
function validateEnv<T extends EnvSchema>(schema: T, configOrEnvFile?: Record<string, unknown> | string, envFile?: string): ValidatedEnv<T> {
    if (!isRecord(schema)) throw new Error('Environment schema must be an object');
    if (Object.getOwnPropertySymbols(schema).length) throw new Error('Environment schema keys must be strings');
    let source: Record<string, unknown>;
    if (configOrEnvFile === undefined || typeof configOrEnvFile === 'string') {
        source = loadEnvFile(typeof configOrEnvFile === 'string' ? configOrEnvFile : envFile);
    } else {
        if (!isRecord(configOrEnvFile)) throw new Error('Environment configuration must be an object');
        source = configOrEnvFile;
    }
    const result: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const key of Object.getOwnPropertyNames(schema)) {
        const item = normalizeItem(key, schema[key], errors);
        if (!item) continue;
        const value = hasOwn(source, key) ? source[key] : undefined;
        let validated: EnvValue | undefined;
        if (value === undefined) {
            if (item.required) errors.push(`Missing required field: ${key}`);
            else validated = item.default;
        } else {
            validated = convertValue(key, value, item.type, errors);
        }
        if (validated !== undefined) {
            Object.defineProperty(result, key, { value: validated, enumerable: true, writable: true, configurable: true });
        }
    }
    if (errors.length) throw new Error(`Environment validation failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
    return result as ValidatedEnv<T>;
}

export { validateEnv };
export type { ValidatedEnv, EnvSchema, EnvSchemaItem } from './types';
