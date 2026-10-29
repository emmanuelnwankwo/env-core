import { expect, it } from '@jest/globals';
import { dependencySnapshot } from '../scripts/dependency-graph';

const context = { repository: 'emmanuelnwankwo/env-core', sha: 'a'.repeat(40), ref: 'refs/heads/main',
    runId: '123', scanned: '2026-10-29T00:00:00.000Z' };
const tree = [{ dependencies: { dotenv: { version: '18.0.9' } }, devDependencies: { jest: { version: '30.5.2' } } }];

it('submits resolved dotenv against the real lockfile without including development tools', () => {
    const snapshot = dependencySnapshot(tree, context);
    expect(snapshot).toMatchObject({ version: 0, sha: context.sha, ref: context.ref, scanned: context.scanned,
        job: { id: '123', correlator: 'env-core-dotenv-runtime', html_url: 'https://github.com/emmanuelnwankwo/env-core/actions/runs/123' } });
    expect(snapshot.manifests['pnpm-lock.yaml']).toEqual({ name: 'pnpm-lock.yaml', file: { source_location: 'pnpm-lock.yaml' },
        resolved: { 'pkg:npm/dotenv@18.0.9': { package_url: 'pkg:npm/dotenv@18.0.9', relationship: 'direct', scope: 'runtime', dependencies: [] } } });
});

it('retains transitive runtime edges, scoped package names and shared nodes without looping', () => {
    const parent: { version: string; dependencies: Record<string, unknown> } = { version: '18.0.9', dependencies: {} };
    const child = { version: '1.2.3-beta.1', dependencies: { dotenv: parent } };
    parent.dependencies = { '@example/child': child, shared: { version: '1.0.0', dependencies: { '@example/child': child } } };
    const nodes = dependencySnapshot([{ dependencies: { dotenv: parent } }], context).manifests['pnpm-lock.yaml'].resolved;
    expect(Object.keys(nodes)).toHaveLength(3);
    expect(nodes['pkg:npm/dotenv@18.0.9'].dependencies).toEqual(['pkg:npm/%40example/child@1.2.3-beta.1', 'pkg:npm/shared@1.0.0']);
    expect(nodes['pkg:npm/%40example/child@1.2.3-beta.1']).toMatchObject({ relationship: 'indirect', scope: 'runtime', dependencies: ['pkg:npm/dotenv@18.0.9'] });
});

it('fails instead of submitting an empty, unresolved or malformed dependency graph', () => {
    for (const invalid of [null, [], [{ dependencies: {} }], [...tree, ...tree],
        [{ dependencies: { dotenv: { version: '^18.0.9' } } }],
        [{ dependencies: { dotenv: { version: '18.0.9', dependencies: [] } } }],
        [{ dependencies: { dotenv: { version: '18.0.9', dependencies: { '../invalid': { version: '1.0.0' } } } } }]]) {
        expect(() => dependencySnapshot(invalid, context)).toThrow();
    }
});

it('rejects off-main submissions and invalid provenance fields', () => {
    for (const invalid of [{ ref: 'refs/pull/1/merge' }, { sha: 'invalid' }, { repository: '../invalid/repo' },
        { runId: '' }, { scanned: 'invalid' }]) {
        expect(() => dependencySnapshot(tree, { ...context, ...invalid })).toThrow();
    }
});
