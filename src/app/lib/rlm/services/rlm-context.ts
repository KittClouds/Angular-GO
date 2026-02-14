import { RLMLoopResult } from '../services/rlm-loop.service';

/**
 * RLM Context Format Definition (V1.0)
 * 
 * Provides deterministic formatting for RLM results injected into LLM context.
 * Versioning ensures prompt stability across model iterations.
 */
export const RLM_CONTEXT_VERSION = 'v1.0';

/**
 * Format RLM Loop Result into a structured context string.
 * 
 * Output Structure:
 * [RLM Context gathered in Xms]
 * ## Reasoning Trace
 * 1. [OBSERVE] ...
 * 2. [PLAN] ...
 * ...
 * 
 * ## Result
 * Result: <output>
 * Reasoning: <reason>
 * Confidence: <0-1>
 * [End Context]
 */
export function formatRlmContext(result: RLMLoopResult, workspaceId: string): string {
    const lines: string[] = [];

    // Header with timing
    lines.push(`[RLM Context gathered in ${result.totalLatMs}ms]`);
    lines.push(`Workspace: ${workspaceId}`);
    lines.push('');

    // Section 1: Reasoning Trace
    lines.push('## Reasoning Trace');
    if (result.steps.length === 0) {
        lines.push('(No reasoning steps recorded)');
    } else {
        result.steps.forEach((step, index) => {
            const stepNum = index + 1;
            const type = step.type.toUpperCase();

            // Extract reasoning based on step type
            let reasoningRaw = '';
            if (step.type === 'plan' && step.result && typeof step.result === 'object' && 'reasoning' in step.result) {
                reasoningRaw = (step.result as { reasoning: string }).reasoning;
            } else if (step.type === 'evaluate' && step.result && typeof step.result === 'object' && 'reason' in step.result) {
                reasoningRaw = (step.result as { reason: string }).reason;
            } else if (step.type === 'observe' && step.result && typeof step.result === 'object' && 'contextSummary' in step.result) {
                reasoningRaw = (step.result as { contextSummary: string }).contextSummary;
            }

            // Truncate reasoning to avoid massive context bloat
            const reasoning = reasoningRaw ? truncate(reasoningRaw, 200) : '';
            lines.push(`${stepNum}. [${type}] ${reasoning}`);

            // Add brief query/action context if available
            if (step.type === 'execute') {
                lines.push(`   -> Action: ${step.nodeId}`);
            }
        });
    }
    lines.push('');

    // Section 2: Result Summary
    lines.push('## Result');

    if (result.output) {
        lines.push(`Result: ${result.output}`);
    } else {
        lines.push('Result: (No direct answer formulated, refer to reasoning trace)');
    }

    if (result.evaluation) {
        lines.push(`Reasoning: ${result.evaluation.reason}`);
        lines.push(`Confidence: ${result.evaluation.confidence}`);
    }

    // Footer
    lines.push('');
    lines.push('[End Context]');

    return lines.join('\n');
}

/**
 * Helper to truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

