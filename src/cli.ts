#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EnvValidationError, generateEnvExample, loadEnv, validateEnv } from './index.ts';
import type { EnvSchema } from './types.ts';

const help = `Usage: env-core <check|example> --schema <file> [options]
  --schema <file>    module with a default schema or named envSchema export
  --file <file>      explicit file layer; repeat in precedence order (check only)
  --override         let file values override process values (check only)
  --no-process-env   use only listed files (check only)
  --json             value-free JSON result (check only)
  --help             show this help

TypeScript schemas require Node 22.18+ native type stripping and erasable syntax.
No files load implicitly. Exit codes: 0 valid, 1 validation failure, 2 usage/load error.
`;

interface CliOptions {
    command: 'check' | 'example';
    schema: string;
    files: string[];
    override: boolean;
    noProcess: boolean;
}

interface SchemaModule {
    default?: EnvSchema;
    envSchema?: EnvSchema;
}

function parseArguments(args: readonly string[]): CliOptions | undefined {
    if (!args.length || args.includes('--help')) return;
    const command = args[0];
    if (command !== 'check' && command !== 'example') throw new Error('Invalid arguments');
    let schema: string | undefined;
    const files: string[] = [];
    let override = false;
    let noProcess = false;
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--schema' || flag === '--file') {
            const value = args[++i];
            if (!value || value.startsWith('--')) throw new Error('Invalid arguments');
            if (flag === '--schema') {
                if (schema !== undefined) throw new Error('Invalid arguments');
                schema = value;
            } else files.push(value);
        } else if (flag === '--override') override = true;
        else if (flag === '--no-process-env') noProcess = true;
        else if (flag !== '--json') throw new Error('Invalid arguments');
    }
    if (!schema || (command === 'example' && (files.length || override || noProcess || args.includes('--json')))) {
        throw new Error('Invalid arguments');
    }
    return { command, schema, files, override, noProcess };
}

const messages = {
    invalid_arguments: 'Invalid arguments; use --help for usage',
    schema_load_failed: 'Unable to load schema module; TypeScript needs Node 22.18+ and erasable syntax',
    source_load_failed: 'Unable to load environment sources',
    validation_failed: 'Unable to validate schema',
};

export async function runCli(
    args: readonly string[],
    write: (text: string, error?: boolean) => void,
    importSchema: (filename: string) => Promise<SchemaModule> = async filename =>
        await import(pathToFileURL(path.resolve(filename)).href) as SchemaModule,
): Promise<number> {
    const json = args.includes('--json');
    let stage: keyof typeof messages = 'invalid_arguments';
    try {
        const options = parseArguments(args);
        if (!options) {
            write(help);
            return 0;
        }
        stage = 'schema_load_failed';
        const module = await importSchema(options.schema);
        const schema = (module.default === undefined ? module.envSchema : module.default) as EnvSchema;
        stage = 'validation_failed';
        if (options.command === 'example') {
            write(generateEnvExample(schema));
            return 0;
        }
        stage = 'source_load_failed';
        const source = loadEnv({ files: options.files, override: options.override,
            ...(options.noProcess ? { processEnv: {} } : {}) });
        stage = 'validation_failed';
        validateEnv(schema, source);
        write(json ? '{"success":true}\n' : 'Environment is valid\n');
        return 0;
    } catch (error) {
        if (error instanceof EnvValidationError) {
            const issues = error.issues.map(({ code, key, sensitive }) => ({ code, ...(key === undefined ? {} : { key }),
                ...(sensitive ? { sensitive } : {}) }));
            write(json ? `${JSON.stringify({ success: false, issues })}\n`
                : `Environment validation failed:\n${issues.map(issue => `- ${JSON.stringify(issue.key ?? '<schema>')}: ${issue.code}`).join('\n')}\n`, !json);
            return 1;
        }
        write(json ? `${JSON.stringify({ success: false, error: { code: stage, message: messages[stage] } })}\n`
            : `${messages[stage]}\n`, !json);
        return 2;
    }
}

if (require.main === module) {
    void runCli(process.argv.slice(2), (text, error) => {
        (error ? process.stderr : process.stdout).write(text);
    }).then(code => { process.exitCode = code; });
}
