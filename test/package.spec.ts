import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';

const root = path.resolve(__dirname, '..');
const fixtures: string[] = [];

function fixture(): string {
    const directory = mkdtempSync(path.join(tmpdir(), 'env-core-package-'));
    fixtures.push(directory);
    for (const name of ['package.json', 'tsconfig.json', 'README.md', 'LICENSE', 'src']) {
        cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
    }
    symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'dir');
    mkdirSync(path.join(directory, 'packed'));
    return directory;
}

function run(command: string, args: string[], cwd: string): string {
    return execFileSync(command, args, { cwd, encoding: 'utf8', timeout: 60000 });
}

afterEach(() => {
    for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('packed package', () => {
    it('builds fresh artifacts and supports typed CommonJS and native ESM consumers', () => {
        const directory = fixture();
        mkdirSync(path.join(directory, 'dist'));
        writeFileSync(path.join(directory, 'dist/stale.js'), '');
        run('pnpm', ['pack', '--pack-destination', 'packed'], directory);
        const archive = path.join(directory, 'packed', readdirSync(path.join(directory, 'packed'))[0]);
        const files = run('tar', ['-tf', archive], directory).trim().split('\n');
        expect(files).toEqual(expect.arrayContaining(['package/dist/index.js', 'package/dist/index.d.ts']));
        expect(files.some(file => /(?:stale|test\/|src\/|\.env)/.test(file))).toBe(false);

        const consumer = path.join(directory, 'consumer');
        const modules = path.join(consumer, 'node_modules');
        mkdirSync(modules, { recursive: true });
        run('tar', ['-xzf', archive, '-C', modules], directory);
        symlinkSync('package', path.join(modules, 'env-core'), 'dir');
        symlinkSync(path.join(root, 'node_modules/dotenv'), path.join(modules, 'dotenv'), 'dir');
        const manifest = JSON.parse(readFileSync(path.join(modules, 'package/package.json'), 'utf8')) as {
            exports: Record<string, string>;
        };
        expect(manifest.exports.import).toMatch(/\.js$/);
        expect(manifest.exports.types).toMatch(/\.d\.ts$/);

        const source = `import { strict as assert } from 'node:assert';
import { validateEnv } from 'env-core';
process.env.PACK_PORT = '3000';
const port: number = validateEnv({ PACK_PORT: Number }).PACK_PORT;
assert.equal(port, 3000);
`;
        writeFileSync(path.join(consumer, 'index.cts'), source);
        writeFileSync(path.join(consumer, 'index.mts'), source + `
const dynamic = await import('env-core');
assert.equal(dynamic.validateEnv, validateEnv);
`);
        writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                strict: true,
                target: 'ES2020',
                module: 'Node16',
                moduleResolution: 'Node16',
                types: ['node'],
                typeRoots: [path.join(root, 'node_modules/@types')],
            },
            include: ['*.cts', '*.mts'],
        }));
        const compiler = require.resolve('typescript/bin/tsc');
        for (const mode of ['Node16', 'NodeNext']) {
            run(process.execPath, [compiler, '-p', '.', '--module', mode, '--moduleResolution', mode, '--outDir', mode], consumer);
            for (const extension of ['cjs', 'mjs']) {
                run(process.execPath, [path.join(mode, `index.${extension}`)], consumer);
            }
        }
        run(process.execPath, [compiler, '-p', '.', '--module', 'Preserve', '--moduleResolution', 'Bundler', '--noEmit'], consumer);
    }, 60000);

    it('fails packing when the source cannot build', () => {
        const directory = fixture();
        writeFileSync(path.join(directory, 'src/index.ts'), "export const broken: number = 'broken';\n");
        const result = spawnSync('pnpm', ['pack', '--pack-destination', 'packed'], {
            cwd: directory,
            encoding: 'utf8',
            timeout: 60000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout + result.stderr).toContain("Type 'string' is not assignable to type 'number'");
        expect(readdirSync(path.join(directory, 'packed'))).toEqual([]);
    }, 60000);
});
