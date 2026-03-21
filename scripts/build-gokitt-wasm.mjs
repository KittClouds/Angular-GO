import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const goKittDir = path.join(rootDir, 'GoKitt');
const outputPath = path.join(goKittDir, 'gokitt.wasm');
const syncScriptPath = path.join(rootDir, 'scripts', 'sync-gokitt-wasm.mjs');

execFileSync('go', ['build', '-o', outputPath, './cmd/wasm'], {
    cwd: goKittDir,
    env: {
        ...process.env,
        GOOS: 'js',
        GOARCH: 'wasm',
    },
    stdio: 'inherit',
});

execFileSync(process.execPath, [syncScriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
});
