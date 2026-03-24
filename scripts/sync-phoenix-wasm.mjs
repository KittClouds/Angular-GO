import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = path.join(rootDir, 'src', 'assets', 'phoenix_wasm.wasm');
const candidatePaths = [
    path.join(rootDir, 'rust', 'phoenix', 'target', 'wasm32-unknown-unknown', 'release', 'phoenix_wasm.wasm'),
    path.join(rootDir, 'rust', 'phoenix', 'target', 'wasm32-unknown-unknown', 'debug', 'phoenix_wasm.wasm'),
];
const staleAssetPaths = [
    path.join(rootDir, 'public', 'phoenix_wasm.wasm'),
    path.join(rootDir, 'public', 'assets', 'phoenix_wasm.wasm'),
    path.join(rootDir, 'src', 'assets', 'wasm', 'phoenix_wasm.wasm'),
];

function sha256(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function pickSourcePath() {
    return candidatePaths.find((candidate) => existsSync(candidate)) || null;
}

const sourcePath = pickSourcePath();
if (!sourcePath) {
    console.error('[sync-phoenix-wasm] Missing source artifact. Expected one of:');
    for (const candidate of candidatePaths) {
        console.error(`  - ${candidate}`);
    }
    process.exit(1);
}

mkdirSync(path.dirname(targetPath), { recursive: true });

const sourceHash = sha256(sourcePath);
const targetHash = existsSync(targetPath) ? sha256(targetPath) : null;

if (sourceHash !== targetHash) {
    copyFileSync(sourcePath, targetPath);
    const sourceStats = statSync(sourcePath);
    console.log(
        `[sync-phoenix-wasm] Synced ${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)} (${sourceStats.size} bytes)`,
    );
} else {
    console.log('[sync-phoenix-wasm] Canonical asset already up to date');
}

for (const stalePath of staleAssetPaths) {
    if (!existsSync(stalePath)) {
        continue;
    }

    rmSync(stalePath, { force: true });
    console.log(`[sync-phoenix-wasm] Removed stale duplicate ${path.relative(rootDir, stalePath)}`);
}
