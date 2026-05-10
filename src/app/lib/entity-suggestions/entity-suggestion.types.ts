import type { EntityKind } from '../types/entity';

export type EntitySuggestionProviderId = 'atlas_surface' | 'dynamic_ner' | 'fst' | 'lfm_local_experiment' | 'gliner_local';

export type EntitySuggestionDevice = 'webgpu' | 'wasm';

export type LocalEntitySuggestionConfidence = 'high' | 'medium' | 'low';

export type SuggestedEntityKind = EntityKind | 'UNKNOWN' | string;

export interface EntitySuggestionScanRequest {
    noteId: string;
    noteTitle?: string;
    plainText: string;
}

export interface EntitySuggestionProviderStatus {
    ready: boolean;
    loading: boolean;
    device: EntitySuggestionDevice | null;
    error?: string;
}

export interface LocalEntitySuggestion {
    label: string;
    kind: SuggestedEntityKind;
    confidence: LocalEntitySuggestionConfidence;
    reasoning: string;
    evidence: string;
    aliases: string[];
    rawScore?: number;
}

export interface EntitySuggestionProviderApi {
    readonly id: EntitySuggestionProviderId;
    scan(request: EntitySuggestionScanRequest): Promise<LocalEntitySuggestion[]>;
    getStatus(): Promise<EntitySuggestionProviderStatus>;
    dispose(): Promise<void>;
}
