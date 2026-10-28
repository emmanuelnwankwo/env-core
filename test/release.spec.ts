import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from '@jest/globals';
import { artifactMetadata, assertReleaseRef, npmPublishNeeded, releaseVersion, verifyMetadata } from '../scripts/release';
import { consumerEnvironment, consumerManager } from '../scripts/consumer';

const fixtures: string[] = [];
const npm = { name: 'env-core', version: '1.1.2' };
const jsr = { name: '@nec/env-core', version: '1.1.2' };

afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('requires matching stable versions and an explicit main release', () => {
    expect(releaseVersion(npm, jsr, '1.1.2')).toBe('1.1.2');
    expect(() => { assertReleaseRef('refs/heads/main', '1.1.2'); }).not.toThrow();
    for (const [left, right, expected] of [
        [{ ...npm, name: 'other' }, jsr, undefined],
        [npm, { ...jsr, name: 'other' }, undefined],
        [{ ...npm, version: '1.1.2-beta.1' }, jsr, undefined],
        [npm, { ...jsr, version: '0.1.1' }, undefined],
        [npm, jsr, '1.1.3'],
    ] as const) expect(() => releaseVersion(left, right, expected)).toThrow();
    expect(() => { assertReleaseRef('refs/heads/feature', '1.1.2'); }).toThrow('main');
    expect(() => { assertReleaseRef('refs/heads/main', ''); }).toThrow('explicit version');
});

it('binds package contents, version, bytes and source commit before publishing or retrying', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'env-core-release-'));
    fixtures.push(root);
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(npm));
    writeFileSync(path.join(root, 'jsr.json'), JSON.stringify(jsr));
    mkdirSync(path.join(root, 'package/dist'), { recursive: true });
    writeFileSync(path.join(root, 'package/package.json'), JSON.stringify(npm));
    writeFileSync(path.join(root, 'package/dist/index.js'), '');
    writeFileSync(path.join(root, 'package/dist/index.d.ts'), '');
    writeFileSync(path.join(root, 'package/dist/index.mjs'), '');
    writeFileSync(path.join(root, 'package/dist/index.d.mts'), '');
    const archive = path.join(root, 'env-core-1.1.2.tgz');
    const entries = ['package/package.json', ...['index.js', 'index.d.ts', 'index.mjs', 'index.d.mts'].map(file => `package/dist/${file}`)];
    const pack = (): void => { execFileSync('tar', ['-czf', archive, ...entries], { cwd: root }); };
    pack();
    const metadata = artifactMetadata(root, archive, 'commit');
    expect(() => { verifyMetadata(root, archive, metadata, 'commit'); }).not.toThrow();
    expect(() => { verifyMetadata(root, archive, metadata, 'other'); }).toThrow('different commit');
    expect(npmPublishNeeded(metadata)).toBe(true);
    expect(npmPublishNeeded(metadata, { dist: { integrity: metadata.integrity } })).toBe(false);
    expect(() => npmPublishNeeded(metadata, { dist: { integrity: 'different' } })).toThrow('different artifact');
    expect(() => npmPublishNeeded(metadata, {})).toThrow('different artifact');
    writeFileSync(path.join(root, 'package/dist/index.js'), 'changed');
    pack();
    expect(() => { verifyMetadata(root, archive, metadata); }).toThrow('integrity mismatch');
    writeFileSync(path.join(root, 'package/package.json'), JSON.stringify({ ...npm, version: '1.1.3' }));
    pack();
    expect(() => artifactMetadata(root, archive, 'commit')).toThrow('version differs');
    execFileSync('tar', ['-czf', archive, 'package/package.json'], { cwd: root });
    expect(() => artifactMetadata(root, archive, 'commit')).toThrow('entry points');
    writeFileSync(path.join(root, 'package/package.json'), JSON.stringify(npm));
    writeFileSync(path.join(root, 'package/.env'), 'SECRET=value');
    execFileSync('tar', ['-czf', archive, ...entries, 'package/.env'], { cwd: root });
    expect(() => artifactMetadata(root, archive, 'commit')).toThrow('contents');
});

it('runs only named consumers without inherited runtime augmentation', () => {
    for (const manager of ['npm', 'pnpm', 'yarn-classic', 'yarn-modern']) expect(consumerManager(manager)).toBe(manager);
    expect(() => consumerManager('unknown')).toThrow('unknown consumer');
    expect(() => consumerManager(undefined)).toThrow('unknown consumer');
    expect(consumerEnvironment({ PATH: '/bin', NODE_OPTIONS: '--require hook', NODE_PATH: '/root', NUB_RUNTIME: '1' }))
        .toEqual({ PATH: '/bin' });
});
