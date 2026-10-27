export type EnvIssueCode = 'invalid_schema' | 'invalid_config' | 'missing_required' | 'invalid_type';

export interface EnvIssue {
    readonly code: EnvIssueCode;
    readonly key?: string;
    readonly message: string;
}

/** aggregated validation failures without input values */
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
