import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { displayKey, EnvValidationError } from './errors.ts';
import type { EnvIssue } from './errors.ts';
import { checkConstraints, normalizeConstraints } from './constraints.ts';
import type { Constraints } from './constraints.ts';
import { checkCustom } from './validators.ts';
import type { EnvSchema, EnvValue, SchemaType, ValidatedEnv, EnvValidator, EnvSourceOptions } from './types.ts';

interface NormalizedItem {
    type: SchemaType;
    required: boolean;
    default: EnvValue | undefined;
    strict: boolean;
    constraints: Constraints | undefined;
    validate: EnvValidator<EnvValue> | undefined;
    sensitive: boolean;
}

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?![\s\S])/;
const templateKey = /^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/;

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaType(value: unknown): value is SchemaType {
    return value === String || value === Number || value === Boolean;
}

function readEnvFile(envFile: string): Record<string, string> {
    const envPath = path.resolve(process.cwd(), envFile);
    try {
        return dotenv.parse(fs.readFileSync(envPath));
    } catch (error) {
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'UNKNOWN';
        throw Object.defineProperty(new Error(`Unable to load environment file ${envPath} (${code})`),
            'cause', { value: error, configurable: true, writable: true });
    }
}

/**
 * loads explicit files in order without mutating process.env
 * @param options.files file paths in precedence order; every file must be readable
 * @param options.override lets file values replace process values; defaults to false
 * @param options.processEnv process source; defaults to process.env, or pass {} for files only
 * @returns a fresh record with later files taking precedence over earlier files
 * @throws TypeError for malformed source options
 * @throws Error if any explicit file cannot be read
 * @example validateEnv(schema, loadEnv({ files: ['.env', '.env.local'] }))
 */
function loadEnv(options: EnvSourceOptions): Record<string, unknown> {
    if (!isRecord(options) || !Array.isArray(options.files) ||
        (options.override !== undefined && typeof options.override !== 'boolean') ||
        (options.processEnv !== undefined && !isRecord(options.processEnv))) {
        throw new TypeError('Invalid environment source options');
    }
    for (const file of options.files) {
        if (typeof file !== 'string' || !file.length) throw new TypeError('Environment file paths must be nonempty strings');
    }
    const source = Object.create(null) as Record<string, unknown>;
    const base = options.processEnv ?? process.env;
    if (options.override) Object.assign(source, base);
    for (const file of options.files) Object.assign(source, readEnvFile(file));
    if (!options.override) Object.assign(source, base);
    return source;
}

/**
 * generates blank assignments without reading field definitions or environment values
 * @param schema field names must be portable identifiers: letters, digits and underscores, starting with a letter or underscore
 * @returns ordered KEY= lines with a trailing newline, or an empty string for an empty schema
 * @throws EnvValidationError for invalid schema objects or unrepresentable keys
 * @example generateEnvExample({ TOKEN: { type: String, sensitive: true } })
 */
function generateEnvExample(schema: EnvSchema): string {
    if (!isRecord(schema) || Object.getOwnPropertySymbols(schema).length) {
        throw new EnvValidationError([{ code: 'invalid_schema', message: 'Environment template schema must be an object with string keys' }]);
    }
    const keys = Object.getOwnPropertyNames(schema);
    const issues: EnvIssue[] = [];
    for (const key of keys) {
        if (!templateKey.test(key)) {
            issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} cannot be represented in an environment template` });
        }
    }
    if (issues.length) throw new EnvValidationError(issues);
    return keys.length ? `${keys.join('=\n')}=\n` : '';
}

/** checks defaults without coercing their declared primitive type */
function validDefault(value: unknown, type: SchemaType): value is EnvValue {
    return type === String ? typeof value === 'string'
        : type === Number ? typeof value === 'number' && !Number.isNaN(value)
        : typeof value === 'boolean';
}

/** validates field definitions before applying missing-value rules */
function normalizeItem(key: string, value: unknown, issues: EnvIssue[]): NormalizedItem | undefined {
    const item = isRecord(value) ? value : { type: value };
    const type = hasOwn(item, 'type') ? item.type : undefined;
    if (!isSchemaType(type)) {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} has an unsupported type` });
        return;
    }
    const required = hasOwn(item, 'required') ? item.required : undefined;
    if (required !== undefined && typeof required !== 'boolean') {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} required must be a boolean` });
        return;
    }
    const fallback = hasOwn(item, 'default') ? item.default : undefined;
    const sensitive = hasOwn(item, 'sensitive') ? item.sensitive : undefined;
    const validate = hasOwn(item, 'validate') ? item.validate : undefined;
    if ((sensitive !== undefined && typeof sensitive !== 'boolean') || (validate !== undefined && typeof validate !== 'function')) {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} has invalid validation options` });
        return;
    }
    const validator = validate as EnvValidator<EnvValue> | undefined;
    const strict = hasOwn(item, 'strict') ? item.strict : undefined;
    if (strict !== undefined && (typeof strict !== 'boolean' || type === String)) {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} strict requires a Number or Boolean field and a boolean flag` });
        return;
    }
    const strictNumber = type === Number && strict !== false;
    if (fallback !== undefined && (!validDefault(fallback, type) ||
        (strictNumber && !Number.isFinite(fallback)))) {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} has an invalid default` });
        return;
    }
    const before = issues.length;
    const constraints = normalizeConstraints(key, item, type, issues);
    if (issues.length !== before) return;
    if (fallback !== undefined && (constraints || validator)) {
        const defaultIssues: EnvIssue[] = [];
        checkConstraints(key, fallback as EnvValue, constraints, defaultIssues);
        if (!defaultIssues.length) checkCustom(key, fallback as EnvValue, validator, sensitive === true, defaultIssues);
        if (defaultIssues.length) {
            issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} has an invalid default` });
            return;
        }
    }
    return {
        type,
        required: required === true || (required !== false && fallback === undefined),
        default: fallback,
        strict: strictNumber,
        constraints,
        validate: validator,
        sensitive: sensitive === true,
    };
}

/** converts present values while keeping raw input out of errors */
function convertValue(key: string, value: unknown, item: NormalizedItem, issues: EnvIssue[]): EnvValue | undefined {
    switch (item.type) {
        case String:
            if (typeof value === 'string') return value;
            issues.push({ code: 'invalid_type', key, message: `${displayKey(key)} should be a string` });
            break;
        case Number:
            if (typeof value === 'string' || typeof value === 'number') {
                const number = Number(value);
                if (item.strict) {
                    if (Number.isFinite(number) && (typeof value === 'number' || decimal.test(value))) return number;
                    issues.push({ code: 'invalid_value', key, message: `${displayKey(key)} should be a finite decimal number` });
                    return;
                }
                if (!Number.isNaN(number)) return number;
            }
            issues.push({ code: 'invalid_type', key, message: `${displayKey(key)} should be a number` });
            break;
        case Boolean:
            if (typeof value === 'boolean') return value;
            if (value === 'true' || value === 'false') return value === 'true';
            issues.push({ code: 'invalid_type', key, message: `${displayKey(key)} should be a boolean` });
    }
}

function validateField(key: string, definition: unknown, source: Record<string, unknown>, issues: EnvIssue[]): EnvValue | undefined {
    const item = normalizeItem(key, definition, issues);
    if (!item) return;
    const value = hasOwn(source, key) ? source[key] : undefined;
    if (value === undefined) {
        if (item.required) issues.push({ code: 'missing_required', key, message: `Missing required field: ${displayKey(key)}` });
        else return item.default;
        return;
    }
    const validated = convertValue(key, value, item, issues);
    if (validated === undefined) return;
    const before = issues.length;
    checkConstraints(key, validated, item.constraints, issues);
    if (issues.length === before) checkCustom(key, validated, item.validate, item.sensitive, issues);
    if (issues.length === before) return validated;
}

/**
 * Validates an explicit configuration object or process.env without loading files.
 *
 * @template T - The type of the environment schema.
 * @param {T} schema - An object describing the expected environment variables and their types.
 *                     Each key can be a constructor (String, Number, Boolean) or an object with
 *                     `type`, `required`, `default`, and optional `strict` properties.
 *                     Number fields accept finite decimal/exponent values without whitespace by default.
 *                     Set `strict: false` on a Number field to retain JavaScript number conversion.
 *                     Boolean fields accept typed booleans or exactly 'true'/'false'; coercion is never used.
 *                     Number constraints: `min`, `max`, `integer`; String constraints: `minLength`, `maxLength`, `pattern`.
 *                     `choices` applies to any field; constraints also validate defaults.
 *                     `validate(value)` runs after built-in checks and must synchronously return true, false, or an error message.
 *                     `sensitive: true` suppresses custom messages and marks issues; successful values are not redacted.
 *                     A valid default makes a field optional unless `required: true` is explicit.
 * @param {Record<string, unknown>} [config=process.env] - The sole configuration source, including already typed numbers and booleans.
 *                                                       No file or process values are merged into an explicit object.
 *                                                       Use `loadEnv` to read explicit files before validation.
 *
 * @returns {ValidatedEnv<T>} A fresh mutable object containing only validated schema fields.
 *                           Missing optional fields are omitted and their inferred types include undefined.
 *                           Schema readonlyness and literal defaults do not narrow returned primitive values.
 * @throws {EnvValidationError} If the schema, configuration or values are invalid, or a required field is missing.
 *                             Issues contain codes and keys; input values are never included in built-in messages.
 *                             Filename and third-argument calls are rejected with invalid_config.
 *
 * @example
 * const env = validateEnv({
 *   PORT: Number,
 *   NODE_ENV: String,
 *   DEBUG: { type: Boolean, default: false }
 * });
 *
 * @example
 * ConfigModule.forRoot({
 *   isGlobal: true,
 *   validate: (config) => validateEnv(envSchema, config),
 * });
 *
 * @example validateEnv(envSchema, loadEnv({ files: ['.env', '.env.local'] }))
 */
function validateEnv<T extends EnvSchema>(schema: T, config?: Record<string, unknown>): ValidatedEnv<T>;
function validateEnv<T extends EnvSchema>(schema: T, config: Record<string, unknown> = process.env): ValidatedEnv<T> {
    if (!isRecord(schema)) throw new EnvValidationError([{ code: 'invalid_schema', message: 'Environment schema must be an object' }]);
    if (Object.getOwnPropertySymbols(schema).length) throw new EnvValidationError([{ code: 'invalid_schema', message: 'Environment schema keys must be strings' }]);
    if (arguments.length > 2) throw new EnvValidationError([{ code: 'invalid_config', message: 'validateEnv accepts only a schema and configuration object' }]);
    if (!isRecord(config)) throw new EnvValidationError([{ code: 'invalid_config', message: 'Environment configuration must be an object' }]);
    const result: Record<string, unknown> = {};
    const issues: EnvIssue[] = [];
    for (const key of Object.getOwnPropertyNames(schema)) {
        const definition = schema[key];
        const sensitive = isRecord(definition) && hasOwn(definition, 'sensitive') && definition.sensitive === true;
        const before = issues.length;
        const validated = validateField(key, definition, config, issues);
        if (sensitive) {
            for (let i = before; i < issues.length; i++) issues[i] = { ...issues[i], sensitive: true };
        }
        if (validated !== undefined) {
            Object.defineProperty(result, key, { value: validated, enumerable: true, writable: true, configurable: true });
        }
    }
    if (issues.length) throw new EnvValidationError(issues);
    return result as ValidatedEnv<T>;
}

export { validateEnv, loadEnv, generateEnvExample };
export { EnvValidationError } from './errors.ts';
export type { EnvIssue, EnvIssueCode } from './errors.ts';
export type { ValidatedEnv, EnvSchema, EnvSchemaItem, EnvValidator, EnvSourceOptions } from './types.ts';
