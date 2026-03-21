import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(rootDir, 'GoKitt', 'gokitt.wasm');
const targetPath = path.join(rootDir, 'src', 'assets', 'gokitt.wasm');
const staleAssetPaths = [
    path.join(rootDir, 'public', 'gokitt.wasm'),
    path.join(rootDir, 'public', 'assets', 'gokitt.wasm'),
    path.join(rootDir, 'src', 'assets', 'wasm', 'gokitt.wasm'),
];

function sha256(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

if (!existsSync(sourcePath)) {
    console.error(`[sync-gokitt-wasm] Missing source artifact: ${sourcePath}`);
    process.exit(1);
}

mkdirSync(path.dirname(targetPath), { recursive: true });

const sourceHash = sha256(sourcePath);
const targetHash = existsSync(targetPath) ? sha256(targetPath) : null;

if (sourceHash !== targetHash) {
    copyFileSync(sourcePath, targetPath);
    const sourceStats = statSync(sourcePath);
    console.log(
        `[sync-gokitt-wasm] Synced ${path.relative(rootDir, sourcePath)} -> ${path.relative(rootDir, targetPath)} (${sourceStats.size} bytes)`
    );
} else {
    console.log('[sync-gokitt-wasm] Canonical asset already up to date');
}

for (const stalePath of staleAssetPaths) {
    if (!existsSync(stalePath)) {
        continue;
    }

    rmSync(stalePath, { force: true });
    console.log(`[sync-gokitt-wasm] Removed stale duplicate ${path.relative(rootDir, stalePath)}`);
}
