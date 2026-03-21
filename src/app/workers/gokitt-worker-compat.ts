export const REQUIRED_GOKITT_METHODS = [
    'initialize',
    'scanImplicit',
    'rebuildDictionary',
    'storeInit',
    'storeGetVersion',
    'storeUpsertScopedDocument',
    'storeGetScopedDocument',
    'storeListScopedDocuments',
    'storeDeleteScopedDocument',
    'storeUpsertScopedEntityField',
    'storeGetScopedEntityField',
    'storeListScopedEntityFields',
    'storeDeleteScopedEntityField',
    'storeUpsertScopedDefinition',
    'storeGetScopedDefinition',
    'storeListScopedDefinitions',
    'storeDeleteScopedDefinition',
] as const;

export const GOKITT_WASM_MISMATCH_CODE = 'GOKITT_WASM_API_MISMATCH';

export type GoKittCompatShape = Partial<Record<string, unknown>> | undefined | null;

export function getMissingGoKittMethods(
    goKittLike: GoKittCompatShape,
    requiredMethods: readonly string[] = REQUIRED_GOKITT_METHODS
): string[] {
    const candidate = goKittLike as Record<string, unknown> | null | undefined;
    return requiredMethods.filter((methodName) => typeof candidate?.[methodName] !== 'function');
}

export function formatGoKittCompatibilityError(missingMethods: readonly string[]): string {
    if (missingMethods.length === 0) {
        return '';
    }

    const methodList = missingMethods.join(', ');
    return `Loaded gokitt.wasm is missing required exports: ${methodList}. The served WASM asset is likely stale relative to gokitt.worker.ts.`;
}
