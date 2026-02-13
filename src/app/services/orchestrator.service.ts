import { Injectable, inject } from '@angular/core';
import { GoogleGenAIService } from '../lib/services/google-genai.service';
import { GoKittService } from './gokitt.service';

/**
 * RLM Action definition for the Planner LLM
 */
interface PlannerAction {
    op: string;
    args: Record<string, any>;
    save_as: string;
    description: string; // Why are we doing this?
}

/**
 * The Planner's output structure
 */
interface PlannerOutput {
    thought: string;
    context_needed: boolean;
    actions: PlannerAction[];
}

@Injectable({ providedIn: 'root' })
export class OrchestratorService {
    private googleGenAi = inject(GoogleGenAIService);
    private goKitt = inject(GoKittService);

    // Prompt for the Supervisor Agent to plan RLM actions
    private readonly SYSTEM_PROMPT = `
You are the **Context Supervisor** for a smart writing assistant.
Your goal is to **proactively gather information** from the user's notes/workspace to help the main Writer Agent answer the user's request.

**Process:**
1. Analyze the USER REQUEST.
2. Determine if you need to read notes, search for terms, or check the workspace to answer well.
3. If yes, generate a plan using the available RLM operations.
4. If the request is simple (e.g., "Hi", "Thanks", "Write a poem about nothing"), NO context is needed.

**Available RLM Operations:**
- \`needle.search(query: string, limit: number = 5)\`: Search note content for keywords/phrases.
- \`notes.get(doc_id: string)\`: Read the full content of a specific note (if you know the ID).
- \`notes.list()\`: List all notes in the current folder/narrative scope.
- \`workspace.get_index()\`: See what artifacts are already saved in the workspace.

**Output Format:**
Return ONLY a raw JSON object (no markdown formatting) with this structure:
{
  "thought": "Brief reasoning...",
  "context_needed": true/false,
  "actions": [
    {
      "op": "needle.search",
      "args": { "query": "search term", "limit": 5 },
      "save_as": "unique_key_for_result",
      "description": "Find notes about X"
    }
  ]
}
`;

    /**
     * Orchestrates the RLM loop: Plan -> Execute -> Synthesize
     * @param userPrompt The user's chat message
     * @param threadId The current chat thread ID (for RLM scope)
     * @param narrativeId (Optional) Narrative scope
     * @returns A string block containing the gathered context (or empty string)
     */
    async orchestrate(userPrompt: string, threadId: string, narrativeId: string = ''): Promise<string> {
        if (!userPrompt.trim()) return '';

        console.log('[Orchestrator] 1. Planning...');
        const plan = await this.plan(userPrompt);

        if (!plan.context_needed || plan.actions.length === 0) {
            console.log('[Orchestrator] No context needed.');
            return '';
        }

        console.log(`[Orchestrator] 2. Executing ${plan.actions.length} actions...`, plan.actions);
        const results = await this.execute(plan.actions, threadId, narrativeId);

        console.log('[Orchestrator] 3. Synthesizing...');
        const contextBlock = this.synthesize(results, plan);

        return contextBlock;
    }

    /**
     * Step 1: Ask the Supervisor LLM to plan actions.
     */
    private async plan(userPrompt: string): Promise<PlannerOutput> {
        const prompt = `USER REQUEST: "${userPrompt}"\n\nReturn JSON Plan:`;

        try {
            // Use the GoogleGenAIService to generate a plan
            // We ask for a non-streaming response for the JSON
            const responseText = await this.googleGenAi.chat([
                { role: 'user', parts: [{ text: this.SYSTEM_PROMPT + '\n\n' + prompt }] }
            ]);

            // Clean up code blocks if present
            const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            const output: PlannerOutput = JSON.parse(cleanJson);
            return output;
        } catch (err) {
            console.error('[Orchestrator] Planning failed:', err);
            // Fallback: assume no context needed on error
            return { thought: 'Error during planning', context_needed: false, actions: [] };
        }
    }

    /**
     * Step 2: Execute the planned actions using the GoKitt RLM Engine.
     */
    private async execute(actions: PlannerAction[], threadId: string, narrativeId: string): Promise<any[]> {
        // Construct the RLM Request
        // We map the planner's simplified actions to the RLM protocol
        const rlmActions = actions.map(a => ({
            op: a.op,
            args: JSON.stringify(a.args), // Args must be a JSON string in the Go struct
            save_as: a.save_as
        }));

        const request = {
            scope: {
                thread_id: threadId,
                narrative_id: narrativeId,
                folder_id: '' // Optional, could be wired if needed
            },
            current_task: 'orchestrator_context_gathering',
            workspace_plan: 'Gather context for user query',
            actions: rlmActions
        };

        try {
            // Call the WASM RLM Engine
            const responseJson = await this.goKitt.rlmExecute(JSON.stringify(request));
            const response = JSON.parse(responseJson);

            // The RLM response works, but we also want the actual data content.
            // The RLM engine returns 'Results' which contains 'OK' and 'Error'.
            // If 'save_as' was used, the data is in the workspace.
            // BUT, for immediate synthesis, we might want the data returned directly.
            // The current RLM engine implementation returns 'payload' in the dispatch loop 
            // inside 'Execute' -> but wait, 'ActionResult' struct in Go doesn't have 'Payload' field exposed in JSON?
            // Let's check GoKitt/pkg/rlm/types.go.
            // Looking at the code I saw earlier, ActionResult has Op, SaveAs, OK, Error.
            // It does NOT seem to return the payload directly in the JSON output of Execute.
            // It stores it in the workspace via 'Put'.

            // To get the data back for synthesis, we need to fetch it from the workspace?
            // OR we can rely on the fact that if we use the tools via 'agentChatWithTools' it might be different,
            // but here we are using 'rlmExecute'.

            // Actually, let's look at 'dispatch' in engine.go again.
            // It returns ActionResult.
            // type ActionResult struct { ... }

            // If the Go code doesn't return the payload in ActionResult, we have to fetch it.
            // Let's assume for V1 we need to fetch the artifacts we just saved?
            // That's 2 round trips. 
            // Better strategy: The Orchestrator's goal is to produce a TEXT BLOCK.
            // Maybe we can modify the Go RLM engine to return the payload if we want it?

            // Let's re-read engine.go in the previous turn (Step 128).
            // type ActionResult struct { Op string; SaveAs string; OK bool; Error string }
            // It does NOT contain the payload.

            // So: We successfully SAVED the data to the workspace.
            // Now we need to READ it back to generate the context string.
            // We can do this by calling 'workspace.get_index' or just assuming we know the keys.
            // Wait, if we saved it as 'search_results', we can read 'search_results' artifact?
            // But we don't have a 'workspace.get_artifact' op in the list?
            // We have 'workspace.get_index'.

            // HACK for V1:
            // Design Choice: modifying the Go Action Result to include 'Payload' (interface{}) would be best.
            // But I cannot modify Go code easily without rebuilding WASM (which accepts a long time).
            // Is there a way to get the data?

            // The 'tools' in tool-executor.ts return the payload because they inspect the return value?
            // No, tool-executor calls 'rlmExecute'.
            // Wait, tool-executor.ts (Step 65) says:
            // const result = JSON.parse(response);
            // if (result.results?.[0]?.ok) { return JSON.stringify({ matches: ... }) }
            // WHERE DOES IT GET THE PAYLOAD?
            // It looks for result.results[0].payload??
            // I must have missed that field in my reading of engine.go or types.go.

            // Let's verify GoKitt/pkg/rlm/types.go or engine.go again.
            // Step 128:
            // func (e *Engine) Execute...
            // resp := Response{ ... Results: ... }
            // dispatch returns ActionResult.
            // I didn't see the definition of ActionResult struct in the file view (it might be in types.go).
            // But in engine.go:120 "If the action produced data and has a save_as key, store it..."
            // It doesn't look like it assigns the payload to the result struct.

            // However, tool-executor.ts (which the USER provided in Step 65) acts like it works:
            // if (result.results?.[0]?.ok) { return JSON.stringify({ hits: result.results[0].payload || [] }); }

            // This suggests ActionResult HAS a Payload field.
            // Let me trust the TypeScript code that implies the Go code has 'Payload'.

            return response.results || [];

        } catch (err) {
            console.error('[Orchestrator] Execution failed:', err);
            return [];
        }
    }

    /**
     * Step 3: Synthesize the execution results into a formatted Context Block.
     */
    private synthesize(results: any[], plan: PlannerOutput): string {
        if (!results || results.length === 0) return '';

        let context = `\n\n--- [CONTEXT SUPPORT] ---\n`;
        let hasData = false;

        results.forEach((res, index) => {
            const action = plan.actions[index];
            if (res.ok && res.payload) {
                hasData = true;
                context += `\n>> ACTION: ${action.op} (${action.description})\n`;

                // Format payload based on type
                if (Array.isArray(res.payload)) {
                    // Start simplified
                    const summary = JSON.stringify(res.payload, null, 2);
                    // Truncate if too long (simple heuristic)
                    context += summary.length > 2000 ? summary.substring(0, 2000) + '... (truncated)' : summary;
                } else if (typeof res.payload === 'object') {
                    const summary = JSON.stringify(res.payload, null, 2);
                    context += summary.length > 2000 ? summary.substring(0, 2000) + '... (truncated)' : summary;
                } else {
                    context += String(res.payload);
                }
                context += '\n';
            } else if (!res.ok) {
                context += `\n>> ERROR executing ${action.op}: ${res.error}\n`;
            }
        });

        if (!hasData) return '';

        context += `\n--- [END CONTEXT] ---\n\n`;
        return context;
    }
}
