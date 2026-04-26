import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const scriptName of ['ensure-gokitt-wasm.mjs', 'ensure-phoenix-wasm.mjs']) {
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', scriptName)], {
        cwd: rootDir,
        stdio: 'inherit',
    });
}
