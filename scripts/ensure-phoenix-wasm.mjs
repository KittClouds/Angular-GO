import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phoenixDir = path.join(rootDir, 'rust', 'phoenix');
const wasmOutputPath = path.join(phoenixDir, 'target', 'wasm32-unknown-unknown', 'release', 'phoenix_wasm.wasm');
const syncScriptPath = path.join(rootDir, 'scripts', 'sync-phoenix-wasm.mjs');
const sourceRoots = [
    path.join(phoenixDir, 'Cargo.toml'),
    path.join(phoenixDir, 'Cargo.lock'),
    path.join(phoenixDir, 'crates'),
    path.join(phoenixDir, 'fixtures'),
];

function getNewestRelevantMtimeMs(targetPath) {
    if (!existsSync(targetPath)) {
        return 0;
    }

    const stats = statSync(targetPath);
    if (stats.isFile()) {
        return stats.mtimeMs;
    }

    let newest = 0;
    for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
            newest = Math.max(newest, getNewestRelevantMtimeMs(fullPath));
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const relevant =
            entry.name.endsWith('.rs') ||
            entry.name.endsWith('.toml') ||
            entry.name.endsWith('.json') ||
            entry.name.endsWith('.md');
        if (!relevant) {
            continue;
        }

        newest = Math.max(newest, statSync(fullPath).mtimeMs);
    }

    return newest;
}

const newestSourceMtimeMs = Math.max(...sourceRoots.map(getNewestRelevantMtimeMs));
const wasmMtimeMs = existsSync(wasmOutputPath) ? statSync(wasmOutputPath).mtimeMs : 0;
const shouldRebuild = !existsSync(wasmOutputPath) || newestSourceMtimeMs > wasmMtimeMs;

if (shouldRebuild) {
    console.log('[ensure-phoenix-wasm] Rust sources are newer than phoenix_wasm.wasm; rebuilding');
    execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'phoenix-wasm'], {
        cwd: phoenixDir,
        stdio: 'inherit',
    });
} else {
    console.log('[ensure-phoenix-wasm] Existing phoenix_wasm.wasm is up to date');
}

execFileSync(process.execPath, [syncScriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
});
