import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const phoenixDir = path.join(rootDir, 'rust', 'phoenix');
const syncScriptPath = path.join(rootDir, 'scripts', 'sync-phoenix-wasm.mjs');

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'phoenix-wasm'], {
    cwd: phoenixDir,
    stdio: 'inherit',
});

execFileSync(process.execPath, [syncScriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
});
