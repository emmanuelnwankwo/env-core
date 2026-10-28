import { EnvValidationError, loadEnv, validateEnv } from '../src/index';
import type { EnvSchema, EnvSchemaItem, ValidatedEnv } from '../src/index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

export const schema = {
    simple: String,
    object: { type: Number },
    optional: { type: String, required: false },
    defaulted: { type: Boolean, default: false },
    optionalDefault: { type: Number, required: false, default: 0 },
    undefinedDefault: { type: Number, required: false, default: undefined },
    explicitlyRequired: { type: Boolean, required: true, default: false },
} as const satisfies EnvSchema;

type Result = ValidatedEnv<typeof schema>;
export declare const widened: EnvSchemaItem<number>;
export declare const optionalDefault: { type: NumberConstructor; required: false; default?: number };
export declare const booleanItem: EnvSchemaItem<boolean>;
export const booleanChoices: EnvSchemaItem<boolean> = { type: Boolean, choices: [true, false], default: false };
export const literalChoices: EnvSchemaItem<'dev' | 'prod'> = { type: String, choices: ['dev', 'prod'] };
export const numericChoices: EnvSchemaItem<1 | 2> = { type: Number, choices: [1, 2], default: 1 };
export const mixedChoices: EnvSchemaItem<string | number> = { type: Number, choices: [1, 2] };

export type InferenceAssertions = [
    Assert<Equal<Result['simple'], string>>,
    Assert<Equal<Result['object'], number>>,
    Assert<Equal<Result['optional'], string | undefined>>,
    Assert<Equal<Result['defaulted'], boolean>>,
    Assert<Equal<Result['optionalDefault'], number>>,
    Assert<Equal<Result['undefinedDefault'], number | undefined>>,
    Assert<Equal<Result['explicitlyRequired'], boolean>>,
    Assert<Equal<ValidatedEnv<{ VALUE: typeof widened }>['VALUE'], number | undefined>>,
    Assert<Equal<ValidatedEnv<{ VALUE: typeof optionalDefault }>['VALUE'], number | undefined>>,
    Assert<Equal<ValidatedEnv<{ VALUE: typeof booleanItem }>['VALUE'], boolean | undefined>>,
    Assert<Equal<EnvSchemaItem<never>, never>>,
    Assert<Equal<EnvSchemaItem<Date>, never>>,
    Assert<Equal<Result, { -readonly [K in keyof Result]: Result[K] }>>,
    Assert<Equal<ValidatedEnv<{ VALUE: typeof literalChoices }>['VALUE'], string | undefined>>,
];

export function inferredSources() {
    const custom = validateEnv({ PORT: { type: Number, validate: (value: number) => value > 0 } }, { PORT: '3000' });
    const customPort: number = custom.PORT;
    const strict: number = validateEnv({ PORT: { type: Number, strict: true } }, { PORT: '3000' }).PORT;
    const result = validateEnv({ PORT: { type: Number }, DEBUG: { type: Boolean, default: false } }, {});
    const number: number = result.PORT;
    const boolean: boolean = result.DEBUG;
    const typedBoolean: EnvSchemaItem<boolean> = { type: Boolean, default: boolean };
    const fromFile: number = validateEnv({ PORT: Number }, loadEnv({ files: ['test.env'] })).PORT;
    const mutable = validateEnv(schema, {});
    mutable.object = 1;
    mutable.defaulted = true;
    mutable.optional = undefined;
    return { number, boolean, typedBoolean, fromFile, strict, customPort };
}

export function rejectedSchemas() {
    // @ts-expect-error filename loading requires loadEnv
    validateEnv({ PORT: Number }, 'test.env');
    // @ts-expect-error the ignored third argument is removed
    validateEnv({ PORT: Number }, {}, 'test.env');
    // @ts-expect-error field constructors must match their value type
    const wrongConstructor: EnvSchemaItem<number> = { type: String };
    // @ts-expect-error literal choices must stay within the declared union
    const wrongChoices: EnvSchemaItem<'dev' | 'prod'> = { type: String, choices: ['test'] };
    validateEnv({ WRONG: wrongConstructor, CHOICES: wrongChoices }, {});
    const typedField: EnvSchemaItem<number> = {
        type: Number,
        validate: value => {
            // @ts-expect-error callback is contextually typed as number
            value.toUpperCase();
            return value > 0;
        },
    };
    validateEnv({ PORT: typedField }, {});
    const literalDefault: EnvSchemaItem<1> = {
        type: Number, default: 1,
        validate: value => {
            // @ts-expect-error callbacks receive numbers beyond the default literal
            const literal: 1 = value;
            return literal === value;
        },
    };
    validateEnv({ PORT: literalDefault }, {});
    // @ts-expect-error async validators are unsupported
    validateEnv({ PORT: { type: Number, validate: async () => true } }, {});
    // @ts-expect-error callback type must match the field constructor
    validateEnv({ PORT: { type: Number, validate: (value: string) => value.length > 0 } }, {});
    // @ts-expect-error sensitive must be a boolean
    validateEnv({ TOKEN: { type: String, sensitive: 'true' } }, {});
    // @ts-expect-error numeric bounds require Number
    validateEnv({ NAME: { type: String, min: 1 } }, {});
    // @ts-expect-error length bounds require String
    validateEnv({ PORT: { type: Number, minLength: 1 } }, {});
    // @ts-expect-error choices must match the field type
    validateEnv({ PORT: { type: Number, choices: ['1'] } }, {});
    // @ts-expect-error pattern must be a RegExp
    validateEnv({ NAME: { type: String, pattern: 'x' } }, {});
    // @ts-expect-error strict parsing applies to numbers and booleans
    validateEnv({ LABEL: { type: String, strict: true } }, {});
    // @ts-expect-error strict must be a boolean
    validateEnv({ PORT: { type: Number, strict: 'true' } }, {});
    const error = new EnvValidationError([{ code: 'invalid_type', key: 'PORT', message: 'invalid' }]);
    // @ts-expect-error readonly issues
    error.issues.push({ code: 'invalid_type', message: 'invalid' });
    // @ts-expect-error readonly issue fields
    error.issues[0].code = 'invalid_schema';
    // @ts-expect-error mismatched numeric default
    validateEnv({ PORT: { type: Number, default: '3000' } }, {});
    // @ts-expect-error mismatched boolean default
    validateEnv({ DEBUG: { type: Boolean, default: 'false' } }, {});
    // @ts-expect-error unsupported constructor
    validateEnv({ DATE: Date }, {});
    // @ts-expect-error invalid required flag
    validateEnv({ PORT: { type: Number, required: 'false' } }, {});
    const result = validateEnv({ OPTIONAL: { type: String, required: false } }, {});
    // @ts-expect-error possibly missing value
    result.OPTIONAL.toUpperCase();
}
