export const PHOENIX_WASM_MISMATCH_CODE = 'PHOENIX_WASM_API_MISMATCH';
export const PHOENIX_STORE_API_VERSION = 1;
export const REQUIRED_PHOENIX_RUNTIME_CAPABILITIES = [
    'note:list',
    'note:get',
    'note:listByIds',
    'persistence:applyWalBatch',
    'persistence:clearDerived',
] as const;

export interface PhoenixRuntimeCapabilities {
    storeApiVersion: number;
    capabilities: string[];
}

export class PhoenixWasmMismatchError extends Error {
    readonly code = PHOENIX_WASM_MISMATCH_CODE;
    readonly repairSteps = [
        'Run `npm run wasm:ensure`.',
        'Restart the Angular dev server.',
        'Hard refresh the browser tab.',
    ];

    constructor(message: string, readonly detail?: string) {
        super(message);
        this.name = 'PhoenixWasmMismatchError';
    }
}

export function isPhoenixWasmMismatchError(error: unknown): error is PhoenixWasmMismatchError {
    return error instanceof PhoenixWasmMismatchError;
}

export function formatPhoenixWasmMismatchMessage(detail?: string): string {
    const prefix =
        'The served Phoenix WASM asset is stale relative to the Angular Phoenix store API.';
    if (!detail?.trim()) {
        return `${prefix} Run \`npm run wasm:ensure\`, restart the dev server, and hard refresh the page.`;
    }
    return `${prefix} ${detail.trim()} Run \`npm run wasm:ensure\`, restart the dev server, and hard refresh the page.`;
}

export function createPhoenixWasmMismatchError(detail?: string): PhoenixWasmMismatchError {
    return new PhoenixWasmMismatchError(formatPhoenixWasmMismatchMessage(detail), detail);
}

export function assertPhoenixRuntimeCapabilities(payload: unknown): PhoenixRuntimeCapabilities {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const storeApiVersion = typeof record['storeApiVersion'] === 'number' ? record['storeApiVersion'] : NaN;
    const capabilities = Array.isArray(record['capabilities'])
        ? record['capabilities'].filter((value): value is string => typeof value === 'string')
        : [];

    if (!Number.isFinite(storeApiVersion)) {
        throw createPhoenixWasmMismatchError('Phoenix runtime did not report a valid store API version.');
    }
    if (storeApiVersion < PHOENIX_STORE_API_VERSION) {
        throw createPhoenixWasmMismatchError(
            `Phoenix runtime store API version ${storeApiVersion} is older than required version ${PHOENIX_STORE_API_VERSION}.`,
        );
    }

    const capabilitySet = new Set(capabilities);
    const missing = REQUIRED_PHOENIX_RUNTIME_CAPABILITIES.filter((capability) => !capabilitySet.has(capability));
    if (missing.length > 0) {
        throw createPhoenixWasmMismatchError(
            `Phoenix runtime is missing required capabilities: ${missing.join(', ')}.`,
        );
    }

    return {
        storeApiVersion,
        capabilities,
    };
}

export function normalizePhoenixRuntimeCompatibilityError(error: unknown): Error {
    if (isPhoenixWasmMismatchError(error)) {
        return error;
    }

    const detail = error instanceof Error ? error.message : String(error || '');
    if (detail.includes('unsupported store command: runtime:capabilities')) {
        return createPhoenixWasmMismatchError(
            'Phoenix runtime does not recognize `runtime:capabilities`, which indicates a stale WASM asset.',
        );
    }

    return error instanceof Error ? error : new Error(detail || 'Unknown Phoenix runtime compatibility failure');
}
