type SchemaType = StringConstructor | NumberConstructor | BooleanConstructor;
type EnvValue = string | number | boolean;
/** returns true for success, false or a message for failure */
type EnvValidator<T extends EnvValue> = (value: T) => boolean | string;

/** selects explicit file layers and an independent process source */
interface EnvSourceOptions {
    readonly files: readonly string[];
    readonly override?: boolean | undefined;
    readonly processEnv?: Record<string, unknown> | undefined;
}

type SchemaItem<C extends SchemaType, T> = {
    type: C;
    required?: boolean | undefined;
    default?: T | undefined;
    strict?: C extends NumberConstructor | BooleanConstructor ? boolean | undefined : undefined;
    min?: C extends NumberConstructor ? number | undefined : undefined;
    max?: C extends NumberConstructor ? number | undefined : undefined;
    integer?: C extends NumberConstructor ? boolean | undefined : undefined;
    minLength?: C extends StringConstructor ? number | undefined : undefined;
    maxLength?: C extends StringConstructor ? number | undefined : undefined;
    pattern?: C extends StringConstructor ? RegExp | undefined : undefined;
    choices?: readonly T[] | undefined;
    validate?: EnvValidator<InferSchemaType<C>> | undefined;
    sensitive?: boolean | undefined;
};

type SchemaPrimitive<T> = unknown extends T ? EnvValue : T;
type SchemaItemFor<C extends SchemaType, T> = [T] extends [never] ? never : SchemaItem<C, T>;

/** keeps field values and callback inputs aligned with their constructor */
type EnvSchemaItem<T = unknown> = SchemaItemFor<StringConstructor, Extract<SchemaPrimitive<T>, string>>
    | SchemaItemFor<NumberConstructor, Extract<SchemaPrimitive<T>, number>>
    | SchemaItemFor<BooleanConstructor, Extract<SchemaPrimitive<T>, boolean>>;

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
    -readonly [K in keyof T]: InferType<T[K]>
};

export type { ValidatedEnv, EnvSchema, EnvSchemaItem, SchemaType, EnvValue, EnvValidator, EnvSourceOptions };
