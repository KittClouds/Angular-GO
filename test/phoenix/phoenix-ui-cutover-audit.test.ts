import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP_ROOT = resolve(process.cwd(), 'src', 'app');

const EXCLUDED_SUFFIXES = [
    '.spec.ts',
    '.test.ts',
];

const EXCLUDED_FILES = new Set([
    'services/gokitt.service.ts',
    'services/gokitt-store.service.ts',
    'workers/gokitt.worker.ts',
    'test/gokitt-graph-test.component.ts',
    'components/memory-module/memory-module.component.ts',
    'components/editor/plugins/toolbar/toolbar.component.ts',
    'lib/services/go-chat.service.ts',
    'lib/services/llm-entity-extractor.service.ts',
    'lib/services/llm-relation-extractor.service.ts',
]);

const ALLOWED_PHOENIX_WASM_IMPORTERS = new Set([
    'services/phoenix-backend.service.ts',
    'services/phoenix-taurpc-bridge.ts',
    'services/phoenix-wasm.service.ts',
    'services/phoenix-ui-api.service.ts',
    'services/phoenix-store.service.ts',
    'lib/services/phoenix-chat.service.ts',
]);

function collectTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            files.push(...collectTypeScriptFiles(fullPath));
            continue;
        }
        if (entry.endsWith('.ts')) {
            files.push(fullPath);
        }
    }
    return files;
}

function isExcluded(relativePath: string): boolean {
    if (EXCLUDED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) {
        return true;
    }
    if (relativePath.startsWith('test/')) {
        return true;
    }
    return EXCLUDED_FILES.has(relativePath);
}

describe('Phoenix UI cutover audit', () => {
    const files = collectTypeScriptFiles(APP_ROOT)
        .map((file) => relative(APP_ROOT, file).replaceAll('\\', '/'))
        .filter((file) => !isExcluded(file));

    it('does not allow live UI code to import GoKitt services', () => {
        const violations: string[] = [];

        for (const relativePath of files) {
            const source = readFileSync(join(APP_ROOT, relativePath), 'utf8');
            if (/import\s+\{[^}]*GoKittService[^}]*\}\s+from\s+['"][^'"]*gokitt\.service['"]/.test(source)) {
                violations.push(`${relativePath}: GoKittService import`);
            }
            if (/import\s+\{[^}]*GoKittStoreService[^}]*\}\s+from\s+['"][^'"]*gokitt-store\.service['"]/.test(source)) {
                violations.push(`${relativePath}: GoKittStoreService import`);
            }
            if (/import\s+\{[^}]*GoChatService[^}]*\}\s+from\s+['"][^'"]*go-chat\.service['"]/.test(source)) {
                violations.push(`${relativePath}: GoChatService import`);
            }
        }

        expect(violations).toEqual([]);
    });

    it('keeps direct Phoenix wasm imports inside the API boundary only', () => {
        const violations: string[] = [];

        for (const relativePath of files) {
            const source = readFileSync(join(APP_ROOT, relativePath), 'utf8');
            if (
                source.includes("from './phoenix-wasm.service'") ||
                source.includes('from "../services/phoenix-wasm.service"') ||
                source.includes('from "../../services/phoenix-wasm.service"') ||
                source.includes('from "../../../services/phoenix-wasm.service"')
            ) {
                if (!ALLOWED_PHOENIX_WASM_IMPORTERS.has(relativePath)) {
                    violations.push(relativePath);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
