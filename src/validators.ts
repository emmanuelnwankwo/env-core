import { displayKey } from './errors.ts';
import type { EnvIssue } from './errors.ts';
import type { EnvValidator, EnvValue } from './types.ts';

export function checkCustom(key: string, value: EnvValue, validate: EnvValidator<EnvValue> | undefined, sensitive: boolean, issues: EnvIssue[]): void {
    if (!validate) return;
    const name = displayKey(key);
    try {
        const result: unknown = validate(value);
        if (result === true) return;
        if (result === false || typeof result === 'string') {
            issues.push({
                code: 'custom_validation', key,
                message: !sensitive && typeof result === 'string' && result.length
                    ? `${name}: ${displayKey(result)}` : `${name} failed custom validation`,
            });
            return;
        }
        if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result) {
            void Promise.resolve(result).catch(() => undefined);
        }
        issues.push({ code: 'invalid_validator', key, message: `${name} validator must return a boolean or a message synchronously` });
    } catch {
        issues.push({ code: 'invalid_validator', key, message: `${name} custom validator threw an error` });
    }
}
