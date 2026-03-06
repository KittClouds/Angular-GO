/**
 * RLM Module Public Surface
 *
 * Runtime path is now Go-native. Keep only the thin orchestrator bridge.
 */

export {
    RlmOrchestratorService,
    type ActivationResult,
    type ToolCallResult,
} from './services/rlm-orchestrator.service';
