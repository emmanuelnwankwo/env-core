interface EnvSchemaItem<T> {
    type: SchemaType;
    required?: boolean;
    default?: T;
}

type SchemaType = typeof String | typeof Number | typeof Boolean;

type EnvSchemaValue<T> = SchemaType | EnvSchemaItem<T>;

type EnvSchema = Record<string, EnvSchemaValue<any>>;

type InferSchemaType<T> = T extends typeof String ? string :
    T extends typeof Number ? number :
    T extends typeof Boolean ? boolean :
    never;

type InferType<T> = T extends SchemaType ? InferSchemaType<T> :
    T extends EnvSchemaItem<infer U> ? U :
    never;

type ValidatedEnv<T extends EnvSchema> = {
    [K in keyof T]: InferType<T[K]>
};

export type { ValidatedEnv, EnvSchema, EnvSchemaItem };