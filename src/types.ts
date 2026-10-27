type SchemaType = StringConstructor | NumberConstructor | BooleanConstructor;
type EnvValue = string | number | boolean;

type SchemaItem<C extends SchemaType, T> = {
    type: C;
    required?: boolean;
    default?: T;
    strict?: C extends NumberConstructor | BooleanConstructor ? boolean : never;
};

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

type ValidatedEnv<T extends EnvSchema> = {
    [K in keyof T]: InferType<T[K]>
};

export type { ValidatedEnv, EnvSchema, EnvSchemaItem, SchemaType, EnvValue };
