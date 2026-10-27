import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface Manifest {
    name: string;
    version: string;
}

export interface ArtifactMetadata {
    name: string;
    version: string;
    filename: string;
    integrity: string;
    commit: string;
}

export function releaseVersion(npm: Manifest, jsr: Manifest, expected?: string): string {
    assert.equal(npm.name, 'env-core', 'unexpected npm package');
    assert.equal(jsr.name, '@nec/env-core', 'unexpected JSR package');
    assert.match(npm.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'release version must be a stable SemVer');
    assert.equal(npm.version, jsr.version, 'npm and JSR versions must match');
    if (expected) assert.equal(npm.version, expected, 'release input does not match package version');
    return npm.version;
}

export function assertReleaseRef(ref: string | undefined, expected: string | undefined): void {
    assert.equal(ref, 'refs/heads/main', 'publishing requires main');
    assert.ok(expected?.trim(), 'publishing requires an explicit version');
}

function manifest(filename: string): Manifest {
    return JSON.parse(readFileSync(filename, 'utf8')) as Manifest;
}

export function checkVersions(root: string, expected?: string): string {
    return releaseVersion(manifest(path.join(root, 'package.json')), manifest(path.join(root, 'jsr.json')), expected);
}

function integrity(archive: string): string {
    return `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
}

export function artifactMetadata(root: string, archive: string, commit: string): ArtifactMetadata {
    const version = checkVersions(root);
    const files = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', timeout: 15000 }).trim().split('\n');
    assert.ok(files.includes('package/dist/index.js') && files.includes('package/dist/index.d.ts'), 'missing package entry points');
    assert.ok(files.every(file => !file.split('/').includes('..') && /^package\/(?:LICENSE|README\.md|package\.json|dist\/[\w./-]+\.(?:js|ts))$/.test(file)), 'unexpected package contents');
    const packed = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], {
        encoding: 'utf8', timeout: 15000,
    })) as Manifest;
    assert.equal(packed.name, 'env-core', 'unexpected packed package');
    assert.equal(packed.version, version, 'packed version differs from source');
    return { name: packed.name, version, filename: path.basename(archive), integrity: integrity(archive), commit };
}

export function verifyMetadata(root: string, archive: string, metadata: ArtifactMetadata, commit?: string): void {
    const actual = artifactMetadata(root, archive, metadata.commit);
    assert.deepEqual(actual, metadata, 'artifact metadata or integrity mismatch');
    if (commit) assert.equal(metadata.commit, commit, 'artifact belongs to a different commit');
}

export function npmPublishNeeded(metadata: ArtifactMetadata, published?: { dist?: { integrity?: string } }): boolean {
    if (!published) return true;
    assert.equal(published.dist?.integrity, metadata.integrity, 'npm version already exists with a different artifact');
    return false;
}

async function npmVersion(version: string): Promise<{ dist?: { integrity?: string } } | undefined> {
    const response = await fetch(`https://registry.npmjs.org/env-core/${encodeURIComponent(version)}`);
    if (response.status === 404) return;
    assert.ok(response.ok, `npm registry returned ${response.status}`);
    return response.json() as Promise<{ dist?: { integrity?: string } }>;
}

function output(values: Record<string, string>): void {
    if (process.env.GITHUB_OUTPUT) {
        for (const [key, value] of Object.entries(values)) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    process.stdout.write(`${JSON.stringify(values)}\n`);
}

async function main(): Promise<void> {
    const [command, archive, metadataFile] = process.argv.slice(2);
    const root = process.cwd();
    if (command === 'check') {
        if (process.argv.includes('--release')) assertReleaseRef(process.env.GITHUB_REF, process.env.RELEASE_VERSION);
        output({ version: checkVersions(root, process.env.RELEASE_VERSION) });
        return;
    }
    assert.ok(archive && metadataFile, 'archive and metadata paths are required');
    if (command === 'artifact') {
        const metadata = artifactMetadata(root, archive, process.env.GITHUB_SHA ?? 'local');
        writeFileSync(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
        return;
    }
    assert.ok(['verify', 'npm-status', 'npm-verify'].includes(command), 'unknown release command');
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as ArtifactMetadata;
    verifyMetadata(root, archive, metadata, process.env.GITHUB_SHA);
    if (command === 'verify') return;
    if (command === 'npm-status') {
        output({ publish: String(npmPublishNeeded(metadata, await npmVersion(metadata.version))) });
        return;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
        const published = await npmVersion(metadata.version);
        if (published) {
            npmPublishNeeded(metadata, published);
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    throw new Error('npm does not serve the verified release artifact yet');
}

if (path.basename(process.argv[1] ?? '') === 'release.ts') void main();
