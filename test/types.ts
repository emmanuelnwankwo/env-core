import { validateEnv } from '../src/index';
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
];

export function inferredOverloads() {
    const result = validateEnv({ PORT: { type: Number }, DEBUG: { type: Boolean, default: false } }, {});
    const number: number = result.PORT;
    const boolean: boolean = result.DEBUG;
    const typedBoolean: EnvSchemaItem<boolean> = { type: Boolean, default: boolean };
    const fromFile: number = validateEnv({ PORT: { type: Number } }, 'test.env').PORT;
    return { number, boolean, typedBoolean, fromFile };
}

export function rejectedSchemas() {
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
