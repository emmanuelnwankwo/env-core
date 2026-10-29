import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

interface ResolvedDependency {
    package_url: string;
    relationship: 'direct' | 'indirect';
    scope: 'runtime';
    dependencies: string[];
}

interface SnapshotContext {
    repository: string;
    sha: string;
    ref: string;
    runId: string;
    scanned: string;
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dependencySnapshot(tree: unknown, context: SnapshotContext) {
    assert.match(context.repository, /^[\w.-]+\/[\w.-]+$/);
    assert.match(context.sha, /^[a-f0-9]{40}$/);
    assert.equal(context.ref, 'refs/heads/main', 'dependency submissions require main');
    assert.match(context.runId, /^\d+$/);
    assert.equal(new Date(context.scanned).toISOString(), context.scanned);
    assert.ok(Array.isArray(tree) && tree.length === 1 && record(tree[0]), 'expected one installed workspace');
    const dependencies = tree[0].dependencies;
    assert.ok(record(dependencies) && record(dependencies.dotenv), 'installed dotenv dependency is missing');
    const resolved: Record<string, ResolvedDependency> = {};
    const visit = (name: string, dependency: unknown, relationship: 'direct' | 'indirect'): string => {
        assert.match(name, /^(?:@[\w.-]+\/)?[\w.-]+$/);
        assert.ok(record(dependency) && typeof dependency.version === 'string', `missing resolved version for ${name}`);
        assert.match(dependency.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/, `invalid resolved version for ${name}`);
        const purl = `pkg:npm/${name.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(dependency.version)}`;
        if (Object.prototype.hasOwnProperty.call(resolved, purl)) return purl;
        const node: ResolvedDependency = { package_url: purl, relationship, scope: 'runtime', dependencies: [] };
        resolved[purl] = node;
        if (dependency.dependencies !== undefined) {
            assert.ok(record(dependency.dependencies), `invalid child dependencies for ${name}`);
            node.dependencies = Object.entries(dependency.dependencies).map(([child, value]) => visit(child, value, 'indirect'));
        }
        return purl;
    };
    visit('dotenv', dependencies.dotenv, 'direct');
    return {
        version: 0,
        sha: context.sha,
        ref: context.ref,
        job: { id: context.runId, correlator: 'env-core-dotenv-runtime',
            html_url: `https://github.com/${context.repository}/actions/runs/${context.runId}` },
        detector: { name: 'env-core-pnpm-runtime', version: '1.0.0',
            url: `https://github.com/${context.repository}/blob/main/scripts/dependency-graph.ts` },
        scanned: context.scanned,
        manifests: {
            'pnpm-lock.yaml': { name: 'pnpm-lock.yaml', file: { source_location: 'pnpm-lock.yaml' }, resolved },
        },
    };
}

if (path.basename(process.argv[1] ?? '') === 'dependency-graph.ts') {
    const output = process.argv[2];
    assert.ok(output, 'snapshot output path is required');
    const tree: unknown = JSON.parse(execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], { encoding: 'utf8' }));
    const snapshot = dependencySnapshot(tree, {
        repository: process.env.GITHUB_REPOSITORY ?? '', sha: process.env.GITHUB_SHA ?? '',
        ref: process.env.GITHUB_REF ?? '', runId: process.env.GITHUB_RUN_ID ?? '', scanned: new Date().toISOString(),
    });
    writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
}
