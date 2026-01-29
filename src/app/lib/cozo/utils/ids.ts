/**
 * Cozo-local utility functions
 * These are isolated within the cozo folder to avoid external dependencies
 */

/**
 * Generate a unique ID using crypto.randomUUID
 * Falls back to timestamp-based ID if crypto is unavailable
 */
export function generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older environments
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Generate a prefixed ID for specific entity types
 */
export function generatePrefixedId(prefix: string): string {
    return `${prefix}_${generateId()}`;
}
