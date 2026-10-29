import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import path from 'node:path';
import type * as Library from '../src/index.ts';
import type { EnvSchema } from '../src/types.ts';
import { consumerEnvironment } from './consumer.ts';

type Api = typeof Library;
type Run = () => unknown;
type Batch = (iterations: number, timed: boolean) => Promise<number>;

export interface BenchmarkOptions {
    baseline?: string;
    output: string;
    samples: number;
    iterations: number;
    warmup: number;
}

interface Workload {
    name: string;
    iterations: number;
    warmup: number;
    run: Run;
    verify: (result: unknown) => void;
}

interface PackageInfo {
    version: string;
    commit: string | null;
    dirty: boolean | null;
    sha256: string;
    compressedBytes: number;
    unpackedBytes: number;
}

interface PackedPackage {
    api: Api;
    directory: string;
    info: PackageInfo;
}

const help = `Usage: pnpm benchmark [options]
  --baseline <directory>  compare with another checkout (install its dependencies first)
  --output <directory>    write results.json and results.md (default: .benchmarks)
  --samples <integer>     batches per implementation (default: 7, minimum: 3)
  --iterations <integer>  validations per batch (default: 10000)
  --warmup <integer>      untimed validations per implementation (default: 10000)
  --help                 show this help

Each checkout is built and packed before measurement. Fixtures use explicit strict
parsing, and every workload must pass a correctness check before timing begins.
Node 22.18+ is required for native TypeScript worker execution.
Implementations run in separate Node processes; timing excludes worker startup
and communication. Each worker remains alive across samples to preserve warm-up.
File I/O uses one tenth of the validation iterations; CLI startup uses one two
thousandth (rounded up). Both are warm-cache measurements with a minimum of one
iteration; validation warm-up may be zero. Baseline/candidate sample order alternates.
Results describe this host and runtime only. Timing results never set a pass/fail
threshold. CI artifacts retain raw samples and metadata for historical comparison.
`;

export function benchmarkOptions(args: string[]): BenchmarkOptions {
    const options: BenchmarkOptions = { output: '.benchmarks', samples: 7, iterations: 10000, warmup: 10000 };
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        const value = args[index + 1];
        assert.ok(['--baseline', '--output', '--samples', '--iterations', '--warmup'].includes(flag)
            && !seen.has(flag) && value && !value.startsWith('--'), `invalid benchmark option: ${flag}`);
        seen.add(flag);
        if (flag === '--baseline') options.baseline = path.resolve(value);
        else if (flag === '--output') options.output = path.resolve(value);
        else {
            const key = flag.slice(2) as 'samples' | 'iterations' | 'warmup';
            const number = Number(value);
            assert.ok(/^\d+$/.test(value) && Number.isSafeInteger(number)
                && number >= (key === 'samples' ? 3 : key === 'warmup' ? 0 : 1), `invalid ${key}`);
            options[key] = number;
        }
    }
    return options;
}

export function summarize(samples: number[]): { medianUs: number; minUs: number; maxUs: number; samplesUs: number[] } {
    assert.ok(samples.length && samples.every(value => Number.isFinite(value) && value > 0), 'invalid timing samples');
    const sorted = [...samples].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return { medianUs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        minUs: sorted[0], maxUs: sorted[sorted.length - 1], samplesUs: [...samples] };
}

export function timeBatch(
    run: Run, iterations: number, timed: boolean,
    now: () => bigint = process.hrtime.bigint,
): number {
    let sink: unknown;
    const start = now();
    for (let index = 0; index < iterations; index++) sink = run();
    const duration = now() - start;
    assert.notEqual(sink, undefined, 'workload must produce a result');
    return timed ? Number(duration) / 1000 / iterations : 0;
}

export async function measure(
    candidate: Batch, baseline: Batch | undefined, options: Pick<BenchmarkOptions, 'iterations' | 'warmup' | 'samples'>,
): Promise<{ candidate: ReturnType<typeof summarize>; baseline?: ReturnType<typeof summarize>; ratio?: number }> {
    if (options.warmup > 0) {
        if (baseline) await baseline(options.warmup, false);
        await candidate(options.warmup, false);
    }
    const samples: [number[], number[]] = [[], []];
    const batch = async (run: Batch, output: number[]): Promise<void> => {
        output.push(await run(options.iterations, true));
    };
    for (let index = 0; index < options.samples; index++) {
        if (baseline && index % 2 === 0) await batch(baseline, samples[0]);
        await batch(candidate, samples[1]);
        if (baseline && index % 2 === 1) await batch(baseline, samples[0]);
    }
    const result = { candidate: summarize(samples[1]) };
    if (!baseline) return result;
    const before = summarize(samples[0]);
    return { ...result, baseline: before, ratio: result.candidate.medianUs / before.medianUs };
}

interface WorkerRequest { index: number; iterations: number; timed: boolean }
interface WorkerReply { ready?: boolean; microseconds?: number; error?: string }

function exchange(child: ChildProcess, request?: WorkerRequest): Promise<WorkerReply> {
    return new Promise((resolve, reject) => {
        const cleanup = (): void => {
            clearTimeout(timer);
            child.off('message', message);
            child.off('error', failure);
            child.off('exit', exit);
        };
        const failure = (error: Error): void => { cleanup(); reject(error); };
        const exit = (): void => { failure(new Error('benchmark worker exited before replying')); };
        const message = (value: WorkerReply): void => {
            cleanup();
            if (value.error) reject(new Error(value.error));
            else resolve(value);
        };
        const timer = setTimeout(() => { failure(new Error('benchmark worker timed out')); }, 120000);
        child.once('message', message);
        child.once('error', failure);
        child.once('exit', exit);
        if (request) child.send(request, error => { if (error) failure(error); });
    });
}

function worker(directory: string, fixtures: string, options: BenchmarkOptions): void {
    try {
        const api = createRequire(path.join(directory, 'package.json'))('env-core') as Api;
        const cases = workloads(api, directory, fixtures, options);
        for (const item of cases) item.verify(item.run());
        process.on('message', (request: WorkerRequest) => {
            try {
                const microseconds = timeBatch(cases[request.index].run, request.iterations, request.timed);
                process.send?.({ microseconds });
            } catch (error) { process.send?.({ error: error instanceof Error ? error.message : 'workload failed' }); }
        });
        process.send?.({ ready: true });
    } catch (error) {
        process.send?.({ error: error instanceof Error ? error.message : 'worker initialization failed' });
    }
}

export function workloads(api: Api, directory: string, fixtures: string, options: BenchmarkOptions): Workload[] {
    const scenarios: Workload[] = [];
    const add = (name: string, run: Run, expected: unknown, divisor = 1): void => {
        scenarios.push({ name, run, iterations: Math.ceil(options.iterations / divisor),
            warmup: divisor === 1 ? options.warmup : Math.max(1, Math.ceil(options.warmup / divisor)),
            verify: result => { assert.deepEqual(result, expected, name); } });
    };
    for (const fields of [1, 10, 30, 100]) {
        const schema: EnvSchema = {};
        const strings: Record<string, unknown> = {};
        const typed: Record<string, unknown> = {};
        for (let index = 0; index < fields; index++) {
            const key = `FIELD_${index}`;
            schema[key] = index % 3 === 0 ? { type: Number, strict: true } : index % 3 === 1 ? String : Boolean;
            strings[key] = index % 3 === 0 ? '3e2' : index % 3 === 1 ? 'production' : 'true';
            typed[key] = index % 3 === 0 ? 300 : index % 3 === 1 ? 'production' : true;
        }
        add(`validation/strings/${fields}`, () => api.validateEnv(schema, strings), typed);
        if (fields === 30) add('validation/typed/30', () => api.validateEnv(schema, typed), typed);
    }
    const defaults: EnvSchema = {};
    const expected: Record<string, unknown> = {};
    const constraints: EnvSchema = {};
    const custom: EnvSchema = {};
    const numbers: EnvSchema = {};
    const input: Record<string, unknown> = {};
    const invalid: Record<string, unknown> = {};
    const processSchema: EnvSchema = {};
    const processExpected: Record<string, unknown> = {};
    for (let index = 0; index < 30; index++) {
        const key = `FIELD_${index}`;
        defaults[key] = index % 2 ? { type: Number, strict: true, required: false } : { type: Number, strict: true, default: 300 };
        if (index % 2 === 0) expected[key] = 300;
        constraints[key] = { type: Number, strict: true, min: 1, max: 65535, integer: true, choices: [300, 400] };
        custom[key] = { type: Number, strict: true, validate: (value: number) => value > 0 };
        numbers[key] = { type: Number, strict: true };
        input[key] = '300';
        invalid[key] = 'invalid';
        processSchema[`ENV_CORE_BENCH_${index}`] = { type: Number, strict: true };
        processExpected[`ENV_CORE_BENCH_${index}`] = 300;
    }
    const numericExpected = Object.fromEntries(Object.keys(input).map(key => [key, 300]));
    add('validation/defaults-optional/30', () => api.validateEnv(defaults, {}), expected);
    add('validation/constraints/30', () => api.validateEnv(constraints, input), numericExpected);
    add('validation/custom/30', () => api.validateEnv(custom, input), numericExpected);
    add('validation/process/30', () => api.validateEnv(processSchema), processExpected);
    scenarios.push({ name: 'validation/errors/30', iterations: options.iterations, warmup: options.warmup,
        run: () => {
            try { api.validateEnv(numbers, invalid); } catch (error) {
                if (error instanceof api.EnvValidationError) return error;
                throw error;
            }
            throw new Error('invalid fixture unexpectedly passed');
        }, verify: result => {
            assert.ok(result instanceof api.EnvValidationError);
            assert.equal(result.issues.length, 30);
            assert.ok(result.issues.every(issue => issue.code === 'invalid_value'));
        } });
    const files = [path.join(fixtures, 'base.env'), path.join(fixtures, 'local.env')];
    const fileExpected: Record<string, unknown> = Object.assign(Object.create(null), input, { FIELD_0: '500', FIELD_1: 'process' });
    add('io/layered-files/30', () => api.loadEnv({ files, processEnv: { FIELD_1: 'process' } }), fileExpected, 10);
    const env = consumerEnvironment(process.env);
    add('cli/startup-check/1', () => JSON.parse(execFileSync(process.execPath,
        [path.join(directory, 'dist/cli.js'), 'check', '--schema', path.join(fixtures, 'schema.cjs'), '--no-process-env', '--json'],
        { cwd: fixtures, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 })) as unknown, { success: true }, 2000);
    return scenarios;
}

function pack(root: string, destination: string): PackedPackage {
    mkdirSync(destination);
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: root, timeout: 120000, stdio: 'pipe' });
    const archives = readdirSync(destination).filter(file => file.endsWith('.tgz'));
    assert.equal(archives.length, 1, 'expected one package archive');
    const archive = path.join(destination, archives[0]);
    const bytes = readFileSync(archive);
    const unpacked = execFileSync('tar', ['-xOf', archive], { maxBuffer: 16 * 1024 * 1024 });
    execFileSync('tar', ['-xf', archive, '-C', destination]);
    const directory = path.join(destination, 'package');
    symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    const require = createRequire(path.join(directory, 'package.json'));
    const api = require('env-core') as Api;
    assert.ok(typeof api.validateEnv === 'function' && typeof api.loadEnv === 'function'
        && typeof api.EnvValidationError === 'function', 'package does not support the benchmark contract');
    let commit: string | null = null;
    let dirty: boolean | null = null;
    try {
        const git = (args: string[]): string => execFileSync('git', ['-C', root, ...args],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        commit = git(['rev-parse', 'HEAD']);
        dirty = git(['status', '--porcelain']).length > 0;
    } catch { /* allows unpacked baselines without git metadata */ }
    const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as { version: string };
    return { api, directory, info: { version: manifest.version, commit, dirty,
        sha256: createHash('sha256').update(bytes).digest('hex'), compressedBytes: bytes.length, unpackedBytes: unpacked.length } };
}

export function markdown(report: BenchmarkReport): string {
    const lines = ['# env-core benchmark', '',
        `Run: ${report.createdAt} | Node ${report.machine.node} | ${report.machine.platform}/${report.machine.arch} | ${report.machine.cpu}`, '',
        'Warm-cache measurements in isolated Node workers; ratio = candidate / baseline (lower is faster). Ranges show batch variation, not confidence intervals. No timing gate.', '',
        '| Workload | Calls/batch | Warm-up | Candidate µs/call (min–max) | Baseline µs/call (min–max) | Ratio |',
        '| --- | ---: | ---: | ---: | ---: | ---: |'];
    const timing = (value: ReturnType<typeof summarize>): string =>
        `${value.medianUs.toFixed(3)} (${value.minUs.toFixed(3)}–${value.maxUs.toFixed(3)})`;
    for (const row of report.results) lines.push(`| ${row.name} | ${row.iterations} | ${row.warmup} | ${timing(row.candidate)} | ${row.baseline ? timing(row.baseline) : '—'} | ${row.ratio?.toFixed(3) ?? '—'} |`);
    lines.push('', '| Package | Commit | Dirty | Compressed bytes | Unpacked bytes |', '| --- | --- | --- | ---: | ---: |');
    for (const [name, info] of Object.entries(report.packages)) {
        lines.push(`| ${name} ${info.version} | ${info.commit ?? 'unknown'} | ${info.dirty ?? 'unknown'} | ${info.compressedBytes} | ${info.unpackedBytes} |`);
    }
    lines.push('', `Samples: ${report.samples}; process environment keys: ${report.machine.processKeys}. Raw samples and archive hashes are in results.json.`, '');
    return lines.join('\n');
}

interface BenchmarkReport {
    formatVersion: 1;
    createdAt: string;
    samples: number;
    machine: { node: string; platform: string; arch: string; cpu: string; cores: number; processKeys: number };
    packages: { candidate: PackageInfo; baseline?: PackageInfo };
    results: ({ name: string; iterations: number; warmup: number } & Awaited<ReturnType<typeof measure>>)[];
}

export async function runBenchmark(root: string, options: BenchmarkOptions): Promise<BenchmarkReport> {
    const directory = mkdtempSync(path.join(tmpdir(), 'env-core-benchmark-'));
    const originalCwd = process.cwd();
    const previous = new Map<string, string | undefined>();
    const children: ChildProcess[] = [];
    try {
        const baseline = options.baseline ? pack(options.baseline, path.join(directory, 'baseline')) : undefined;
        const candidate = pack(root, path.join(directory, 'candidate'));
        const fixtures = path.join(directory, 'fixtures');
        mkdirSync(fixtures);
        writeFileSync(path.join(fixtures, 'base.env'), Array.from({ length: 30 }, (_, index) => `FIELD_${index}=300`).join('\n'));
        writeFileSync(path.join(fixtures, 'local.env'), 'FIELD_0=500\nFIELD_1=file\n');
        writeFileSync(path.join(fixtures, 'schema.cjs'), 'module.exports = { PORT: { type: Number, strict: true, default: 300 } };\n');
        for (let index = 0; index < 30; index++) {
            const key = `ENV_CORE_BENCH_${index}`;
            previous.set(key, process.env[key]);
            process.env[key] = '300';
        }
        process.chdir(fixtures);
        const candidateWorkloads = workloads(candidate.api, candidate.directory, fixtures, options);
        const startWorker = async (pkg: PackedPackage): Promise<ChildProcess> => {
            const child = fork(path.join(root, 'scripts/benchmark.ts'), ['--worker', pkg.directory, fixtures, JSON.stringify(options)],
                { cwd: fixtures, env: consumerEnvironment(process.env), execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
            children.push(child);
            let stderr = '';
            child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
            try { assert.equal((await exchange(child)).ready, true, 'worker did not initialize'); }
            catch (error) {
                throw Object.defineProperty(new Error(`${error instanceof Error ? error.message : 'worker failed'}${stderr ? `\n${stderr}` : ''}`),
                    'cause', { value: error });
            }
            return child;
        };
        const before = baseline ? await startWorker(baseline) : undefined;
        const after = await startWorker(candidate);
        const report: BenchmarkReport = { formatVersion: 1, createdAt: new Date().toISOString(), samples: options.samples,
            machine: { node: process.version, platform: process.platform, arch: process.arch,
                cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, processKeys: Object.keys(consumerEnvironment(process.env)).length },
            packages: { candidate: candidate.info, ...(baseline ? { baseline: baseline.info } : {}) },
            results: [] };
        for (const [index, workload] of candidateWorkloads.entries()) {
            const request = (child: ChildProcess): Batch => async (iterations, timed) => {
                const reply = await exchange(child, { index, iterations, timed });
                assert.equal(typeof reply.microseconds, 'number', 'worker returned an invalid measurement');
                return reply.microseconds as number;
            };
            report.results.push({ name: workload.name, iterations: workload.iterations, warmup: workload.warmup,
                ...await measure(request(after), before ? request(before) : undefined,
                    { ...options, iterations: workload.iterations, warmup: workload.warmup }) });
        }
        const output = path.resolve(originalCwd, options.output);
        mkdirSync(output, { recursive: true });
        writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(report, null, 2)}\n`);
        const summary = markdown(report);
        writeFileSync(path.join(output, 'results.md'), summary);
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
        process.stdout.write(summary);
        return report;
    } finally {
        await Promise.all(children.map(child => new Promise<void>(resolve => {
            if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
            child.once('exit', () => { resolve(); });
            child.kill();
        })));
        process.chdir(originalCwd);
        for (const [key, value] of previous) {
            if (value === undefined) Reflect.deleteProperty(process.env, key);
            else process.env[key] = value;
        }
        rmSync(directory, { recursive: true, force: true });
    }
}

if (path.basename(process.argv[1] ?? '') === 'benchmark.ts') {
    if (process.argv[2] === '--worker') {
        worker(process.argv[3], process.argv[4], JSON.parse(process.argv[5]) as BenchmarkOptions);
    } else if (process.argv.includes('--help')) process.stdout.write(help);
    else {
        const fail = (error: unknown): void => {
            process.stderr.write(`${error instanceof Error ? error.message : 'Benchmark failed'}\n`);
            process.exitCode = 1;
        };
        try { void runBenchmark(process.cwd(), benchmarkOptions(process.argv.slice(2))).catch(fail); }
        catch (error) {
            fail(error);
        }
    }
}
