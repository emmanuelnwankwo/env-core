import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import * as api from '../src/index';
import { benchmarkOptions, markdown, measure, summarize, timeBatch, workloads } from '../scripts/benchmark';

describe('benchmark reporting', () => {
    test('validates options without permitting unknown, duplicate or malformed arguments', () => {
        expect(benchmarkOptions([])).toEqual({ output: '.benchmarks', samples: 7, iterations: 10000, warmup: 10000 });
        expect(benchmarkOptions(['--baseline', '.', '--output', 'reports', '--samples', '4', '--iterations', '1', '--warmup', '0']))
            .toEqual({ baseline: process.cwd(), output: path.resolve('reports'), samples: 4, iterations: 1, warmup: 0 });
        for (const args of [['--unknown', '1'], ['--output'], ['--output', '--samples'], ['--samples', '2'],
            ['--iterations', '0'], ['--warmup', '-1'], ['--samples', '3.5'], ['--iterations', 'Infinity'],
            ['--iterations', '9007199254740992'], ['--samples', '3', '--samples', '5']]) {
            expect(() => benchmarkOptions(args)).toThrow();
        }
    });

    test('retains raw samples, computes odd/even medians and rejects unusable measurements', () => {
        const samples = [3, 1, 2];
        expect(summarize(samples)).toEqual({ medianUs: 2, minUs: 1, maxUs: 3, samplesUs: [3, 1, 2] });
        expect(samples).toEqual([3, 1, 2]);
        expect(summarize([4, 1, 2, 3]).medianUs).toBe(2.5);
        for (const invalid of [[], [0], [-1], [NaN], [Infinity]]) expect(() => summarize(invalid)).toThrow();
    });

    test('warms both implementations and alternates timed batches with equivalent call counts', async () => {
        let clock = BigInt(0);
        const calls: string[] = [];
        const batch = (name: string, duration: number) => (iterations: number, timed: boolean): Promise<number> =>
            Promise.resolve(timeBatch(() => { calls.push(name); clock += BigInt(duration); return 1; }, iterations, timed, () => clock));
        const candidate = batch('candidate', 2000);
        const baseline = batch('baseline', 1000);
        const result = await measure(candidate, baseline, { samples: 4, iterations: 2, warmup: 1 });
        expect(calls).toEqual(['baseline', 'candidate',
            'baseline', 'baseline', 'candidate', 'candidate', 'candidate', 'candidate', 'baseline', 'baseline',
            'baseline', 'baseline', 'candidate', 'candidate', 'candidate', 'candidate', 'baseline', 'baseline']);
        expect(result).toEqual({ candidate: { medianUs: 2, minUs: 2, maxUs: 2, samplesUs: [2, 2, 2, 2] },
            baseline: { medianUs: 1, minUs: 1, maxUs: 1, samplesUs: [1, 1, 1, 1] }, ratio: 2 });
        const alone = await measure(candidate, undefined, { samples: 3, iterations: 1, warmup: 0 });
        expect(alone).toEqual({ candidate: { medianUs: 2, minUs: 2, maxUs: 2, samplesUs: [2, 2, 2] } });
        await expect(measure(() => Promise.reject(new Error('broken fixture')), baseline,
            { samples: 3, iterations: 1, warmup: 0 })).rejects.toThrow('broken fixture');
        expect(() => timeBatch(() => undefined, 1, true)).toThrow('workload must produce a result');
    });

    test('checks real workload results and fails preflight for incorrect outputs', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'env-core-benchmark-test-'));
        const saved = new Map<string, string | undefined>();
        try {
            writeFileSync(path.join(directory, 'base.env'), Array.from({ length: 30 }, (_, index) => `FIELD_${index}=300`).join('\n'));
            writeFileSync(path.join(directory, 'local.env'), 'FIELD_0=500\nFIELD_1=file\n');
            for (let index = 0; index < 30; index++) {
                const key = `ENV_CORE_BENCH_${index}`;
                saved.set(key, process.env[key]);
                process.env[key] = '300';
            }
            const options = benchmarkOptions(['--iterations', '1', '--warmup', '0']);
            const cases = workloads(api, directory, directory, options);
            expect(cases).toHaveLength(12);
            for (const workload of cases.filter(item => !item.name.startsWith('cli/'))) {
                expect(() => { workload.verify(workload.run()); }).not.toThrow();
                expect(() => { workload.verify(undefined); }).toThrow();
                expect(workload.iterations).toBe(1);
            }
            expect(() => cases[cases.length - 1].run()).toThrow();
            expect(process.env.ENV_CORE_BENCH_0).toBe('300');
        } finally {
            for (const [key, value] of saved) {
                if (value === undefined) Reflect.deleteProperty(process.env, key);
                else process.env[key] = value;
            }
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('labels ratios, variation and provenance without claiming a timing gate', () => {
        const info = { version: '2.0.0', commit: 'abc123', dirty: true, sha256: 'hash', compressedBytes: 100, unpackedBytes: 200 };
        const report = { formatVersion: 1 as const, createdAt: '2026-10-29T00:00:00.000Z', samples: 3,
            machine: { node: 'v24', platform: 'linux', arch: 'x64', cpu: 'test CPU', cores: 2, processKeys: 30 },
            packages: { candidate: info, baseline: { ...info, dirty: false } },
            results: [{ name: 'validation/strings/1', iterations: 100, warmup: 20,
                candidate: summarize([1, 2, 3]), baseline: summarize([2, 4, 6]), ratio: 0.5 }] };
        const output = markdown(report);
        expect(output).toContain('| validation/strings/1 | 100 | 20 | 2.000 (1.000–3.000) | 4.000 (2.000–6.000) | 0.500 |');
        expect(output).toContain('| candidate 2.0.0 | abc123 | true | 100 | 200 |');
        expect(output).toContain('not confidence intervals. No timing gate.');
        expect(markdown({ ...report, packages: { candidate: info }, results: [{ name: 'single', iterations: 1, warmup: 0,
            candidate: summarize([1]) }] })).toContain('| single | 1 | 0 | 1.000 (1.000–1.000) | — | — |');
    });
});
