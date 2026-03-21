import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goKittDir = path.join(rootDir, 'GoKitt');
const wasmOutputPath = path.join(goKittDir, 'gokitt.wasm');
const syncScriptPath = path.join(rootDir, 'scripts', 'sync-gokitt-wasm.mjs');
const goSourceRoots = [
    path.join(goKittDir, 'cmd'),
    path.join(goKittDir, 'internal'),
    path.join(goKittDir, 'pkg'),
];

function getNewestGoSourceMtimeMs(dirPath) {
    if (!existsSync(dirPath)) {
        return 0;
    }

    let newest = 0;

    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            newest = Math.max(newest, getNewestGoSourceMtimeMs(fullPath));
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.go')) {
            continue;
        }

        newest = Math.max(newest, statSync(fullPath).mtimeMs);
    }

    return newest;
}

const newestSourceMtimeMs = Math.max(...goSourceRoots.map(getNewestGoSourceMtimeMs));
const wasmMtimeMs = existsSync(wasmOutputPath) ? statSync(wasmOutputPath).mtimeMs : 0;
const shouldRebuild = !existsSync(wasmOutputPath) || newestSourceMtimeMs > wasmMtimeMs;

if (shouldRebuild) {
    console.log('[ensure-gokitt-wasm] Go sources are newer than gokitt.wasm; rebuilding');
    execFileSync('go', ['build', '-o', wasmOutputPath, './cmd/wasm'], {
        cwd: goKittDir,
        env: {
            ...process.env,
            GOOS: 'js',
            GOARCH: 'wasm',
        },
        stdio: 'inherit',
    });
} else {
    console.log('[ensure-gokitt-wasm] Existing gokitt.wasm is up to date');
}

execFileSync(process.execPath, [syncScriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
});
