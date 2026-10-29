import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

interface ResolvedDependency {
    package_url: string;
    relationship: 'direct' | 'indirect';
    scope: 'runtime' | 'development';
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
    const root = tree[0];
    const dependencies = root.dependencies;
    assert.ok(record(dependencies) && record(dependencies.dotenv), 'installed dotenv dependency is missing');
    const resolved: Record<string, ResolvedDependency> = {};
    const visit = (name: string, dependency: unknown, relationship: 'direct' | 'indirect', scope: 'runtime' | 'development'): string => {
        assert.ok(record(dependency) && typeof dependency.version === 'string', `missing resolved version for ${name}`);
        const canonical = dependency.from ?? name;
        assert.ok(typeof canonical === 'string');
        assert.match(canonical, /^(?:@[\w.-]+\/)?[\w.-]+$/);
        assert.match(dependency.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/, `invalid resolved version for ${name}`);
        const purl = `pkg:npm/${canonical.split('/').map(encodeURIComponent).join('/')}@${encodeURIComponent(dependency.version)}`;
        if (Object.prototype.hasOwnProperty.call(resolved, purl)) {
            const existing = resolved[purl];
            if (relationship === 'direct') existing.relationship = relationship;
            return purl;
        }
        const node: ResolvedDependency = { package_url: purl, relationship, scope, dependencies: [] };
        resolved[purl] = node;
        for (const field of ['dependencies', 'optionalDependencies']) {
            const children = dependency[field];
            if (children === undefined) continue;
            assert.ok(record(children), `invalid child dependencies for ${name}`);
            for (const [child, value] of Object.entries(children)) node.dependencies.push(visit(child, value, 'indirect', scope));
        }
        node.dependencies = [...new Set(node.dependencies)];
        return purl;
    };
    // visits runtime roots first to preserve shared dependency scope
    for (const [field, scope] of [['dependencies', 'runtime'], ['optionalDependencies', 'runtime'], ['devDependencies', 'development']] as const) {
        const entries = root[field];
        if (entries === undefined) continue;
        assert.ok(record(entries), `invalid ${field}`);
        for (const [name, dependency] of Object.entries(entries)) visit(name, dependency, 'direct', scope);
    }
    return {
        version: 0,
        sha: context.sha,
        ref: context.ref,
        job: { id: context.runId, correlator: 'env-core-dotenv-runtime',
            html_url: `https://github.com/${context.repository}/actions/runs/${context.runId}` },
        detector: { name: 'env-core-pnpm-runtime', version: '1.1.0',
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
    const tree: unknown = JSON.parse(execFileSync('pnpm', ['list', '--depth', 'Infinity', '--json'],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    const snapshot = dependencySnapshot(tree, {
        repository: process.env.GITHUB_REPOSITORY ?? '', sha: process.env.GITHUB_SHA ?? '',
        ref: process.env.GITHUB_REF ?? '', runId: process.env.GITHUB_RUN_ID ?? '', scanned: new Date().toISOString(),
    });
    writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`);
}
