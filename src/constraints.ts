import { displayKey } from './errors.ts';
import type { EnvIssue } from './errors.ts';
import type { EnvValue, SchemaType } from './types.ts';

export interface Constraints {
    min?: number;
    max?: number;
    integer?: boolean;
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    choices?: readonly EnvValue[];
}

export function normalizeConstraints(key: string, item: Record<string, unknown>, type: SchemaType, issues: EnvIssue[]): Constraints | undefined {
    const own = (name: string): unknown => Object.prototype.hasOwnProperty.call(item, name) ? item[name] : undefined;
    const rules: Constraints = {};
    const invalid = (message: string): undefined => {
        issues.push({ code: 'invalid_schema', key, message: `${displayKey(key)} ${message}` });
        return undefined;
    };
    for (const [name, constructor] of [['min', Number], ['max', Number], ['minLength', String], ['maxLength', String]] as const) {
        const value = own(name);
        if (value === undefined) continue;
        if (type !== constructor || typeof value !== 'number' || !Number.isFinite(value) ||
            (constructor === String && (!Number.isSafeInteger(value) || value < 0))) { invalid(`has an invalid ${name} constraint`); return; }
        rules[name] = value;
    }
    if ((rules.min !== undefined && rules.max !== undefined && rules.min > rules.max) ||
        (rules.minLength !== undefined && rules.maxLength !== undefined && rules.minLength > rules.maxLength)) {
        invalid('has contradictory bounds'); return;
    }
    const integer = own('integer');
    if (integer !== undefined) {
        if (type !== Number || typeof integer !== 'boolean') { invalid('has an invalid integer constraint'); return; }
        rules.integer = integer;
    }
    const pattern = own('pattern');
    if (pattern !== undefined) {
        if (type !== String || !(pattern instanceof RegExp)) { invalid('has an invalid pattern constraint'); return; }
        rules.pattern = new RegExp(pattern.source, pattern.flags);
    }
    const choices = own('choices');
    if (choices !== undefined) {
        if (!Array.isArray(choices) || choices.length === 0) { invalid('has invalid choices'); return; }
        const values: unknown[] = Array.from(choices);
        if (!values.every(value => type === String ? typeof value === 'string'
            : type === Boolean ? typeof value === 'boolean' : typeof value === 'number' && Number.isFinite(value))) {
            invalid('has invalid choices'); return;
        }
        rules.choices = values as EnvValue[];
    }
    return Object.keys(rules).length ? rules : undefined;
}

export function checkConstraints(key: string, value: EnvValue, rules: Constraints | undefined, issues: EnvIssue[]): void {
    if (!rules) return;
    const name = displayKey(key);
    if (typeof value === 'number') {
        if ((rules.min !== undefined || rules.max !== undefined || rules.integer === true) && !Number.isFinite(value)) {
            issues.push({ code: 'invalid_value', key, message: `${name} should be a finite number` });
            return;
        }
        if (rules.min !== undefined && value < rules.min) issues.push({ code: 'too_small', key, message: `${name} must be at least ${rules.min}` });
        if (rules.max !== undefined && value > rules.max) issues.push({ code: 'too_big', key, message: `${name} must be at most ${rules.max}` });
        if (rules.integer && !Number.isSafeInteger(value)) issues.push({ code: 'not_integer', key, message: `${name} must be a safe integer` });
    } else if (typeof value === 'string') {
        if (rules.minLength !== undefined && value.length < rules.minLength) issues.push({ code: 'too_small', key, message: `${name} must have at least ${rules.minLength} characters` });
        if (rules.maxLength !== undefined && value.length > rules.maxLength) issues.push({ code: 'too_big', key, message: `${name} must have at most ${rules.maxLength} characters` });
        if (rules.pattern) {
            rules.pattern.lastIndex = 0;
            const matches = rules.pattern.test(value);
            rules.pattern.lastIndex = 0;
            if (!matches) issues.push({ code: 'invalid_pattern', key, message: `${name} does not match the required pattern` });
        }
    }
    if (rules.choices && !rules.choices.includes(value)) issues.push({ code: 'invalid_choice', key, message: `${name} is not an allowed value` });
}
