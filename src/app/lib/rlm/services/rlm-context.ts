/**
 * RLM Context Format Definition (V1.0)
 *
 * Provides deterministic formatting for workspace activation results
 * injected into the LLM context window. Versioning ensures prompt
 * stability across model iterations.
 *
 * NOTE: The old CozoDB-based RLMLoopResult is gone. This module now
 * formats ActivationResult from the Go workspace sandbox.
 */
export const RLM_CONTEXT_VERSION = 'v1.0';

/**
 * Minimal shape of an ActivationResult for formatting.
 * Keep in sync with RlmOrchestratorService.ActivationResult.
 */
interface FormattableResult {
    triggered: boolean;
    miss_reason?: string;
    summary?: string;
    new_observation?: string;
    tool_calls?: Array<{ tool: string; ok: boolean; lat_ms: number }>;
}

/**
 * Format a workspace ActivationResult into a structured context string
 * for injection into the LLM system prompt.
 *
 * When workspace didn't fire (triggered = false), returns an empty string
 * — the LLM gets nothing extra.
 */
export function formatRlmContext(result: FormattableResult, workspaceId: string): string {
    if (!result.triggered) return '';

    const lines: string[] = [];

    lines.push(`[Workspace Context — ${workspaceId}]`);
    if (result.miss_reason) {
        lines.push(`Miss signal: ${result.miss_reason}`);
    }
    lines.push('');

    if (result.tool_calls?.length) {
        lines.push('## Tools Run');
        for (const t of result.tool_calls) {
            lines.push(`- ${t.tool} (${t.ok ? 'ok' : 'err'}, ${t.lat_ms}ms)`);
        }
        lines.push('');
    }

    if (result.summary) {
        lines.push('## Resurfaced Context');
        lines.push(result.summary);
        lines.push('');
    }

    lines.push('[End Workspace Context]');
    return lines.join('\n');
}
