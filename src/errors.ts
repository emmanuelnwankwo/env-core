export type EnvIssueCode = 'invalid_schema' | 'invalid_config' | 'missing_required' | 'invalid_type' | 'invalid_value'
    | 'too_small' | 'too_big' | 'not_integer' | 'invalid_pattern' | 'invalid_choice' | 'custom_validation' | 'invalid_validator';

export interface EnvIssue {
    readonly code: EnvIssueCode;
    /** absent for schema-wide failures */
    readonly key?: string;
    readonly message: string;
    /** marks fields whose custom messages are suppressed */
    readonly sensitive?: true;
}

/** aggregated validation failures with structured issues */
export class EnvValidationError extends Error {
    readonly issues: readonly EnvIssue[];

    constructor(issues: readonly EnvIssue[]) {
        super(`Environment validation failed:\n${issues.map(issue => `- ${issue.message}`).join('\n')}`);
        this.name = 'EnvValidationError';
        this.issues = Object.freeze(issues.map(issue => Object.freeze({ ...issue })));
    }
}

export function displayKey(key: string): string {
    return JSON.stringify(key).slice(1, -1);
}
