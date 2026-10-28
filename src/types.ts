type SchemaType = StringConstructor | NumberConstructor | BooleanConstructor;
type EnvValue = string | number | boolean;
/** returns true for success, false or a message for failure */
type EnvValidator<T extends EnvValue> = (value: T) => boolean | string;

/** selects explicit file layers and an independent process source */
interface EnvSourceOptions {
    readonly files: readonly string[];
    readonly override?: boolean;
    readonly processEnv?: Record<string, unknown>;
}

type SchemaItem<C extends SchemaType, T> = {
    type: C;
    required?: boolean;
    default?: T;
    strict?: C extends NumberConstructor | BooleanConstructor ? boolean : never;
    min?: C extends NumberConstructor ? number : never;
    max?: C extends NumberConstructor ? number : never;
    integer?: C extends NumberConstructor ? boolean : never;
    minLength?: C extends StringConstructor ? number : never;
    maxLength?: C extends StringConstructor ? number : never;
    pattern?: C extends StringConstructor ? RegExp : never;
    choices?: readonly T[];
    validate?: EnvValidator<InferSchemaType<C>>;
    sensitive?: boolean;
};

/** keeps field values and callback inputs aligned with their constructor */
type EnvSchemaItem<T = unknown> = unknown extends T
    ? SchemaItem<StringConstructor, string> | SchemaItem<NumberConstructor, number> | SchemaItem<BooleanConstructor, boolean>
    : T extends string ? SchemaItem<StringConstructor, T>
    : T extends number ? SchemaItem<NumberConstructor, T>
    : T extends boolean ? SchemaItem<BooleanConstructor, T>
    : never;

type EnvSchema = Record<string, SchemaType | EnvSchemaItem>;

type InferSchemaType<T> = T extends StringConstructor ? string
    : T extends NumberConstructor ? number
    : T extends BooleanConstructor ? boolean
    : never;

type OptionalValue<T> = 'required' extends keyof T
    ? false extends T['required'] ? undefined : never
    : never;

type MissingValue<T> = T extends { required: true } ? never
    : T extends { default: infer D } ? undefined extends D ? OptionalValue<T> : never
    : OptionalValue<T>;

type InferType<T> = T extends { type: infer C }
    ? InferSchemaType<C> | MissingValue<T>
    : InferSchemaType<T>;

/** includes undefined for optional fields without a defined default */
type ValidatedEnv<T extends EnvSchema> = {
    [K in keyof T]: InferType<T[K]>
};

export type { ValidatedEnv, EnvSchema, EnvSchemaItem, SchemaType, EnvValue, EnvValidator, EnvSourceOptions };
