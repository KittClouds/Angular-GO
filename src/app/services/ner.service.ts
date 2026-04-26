import { Injectable, computed, inject, signal } from '@angular/core';
import {
    coalesceDiscoveryCandidates,
    type PhoenixDiscoveryCandidate,
} from '../lib/phoenix/phoenix-discovery';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import { NoteEditorStore } from '../lib/store/note-editor.store';
import { smartGraphRegistry } from '../lib/registry';
import { getSetting, setSetting } from '../lib/dexie/settings.service';
import { v4 as uuidv4 } from 'uuid';
import { LfmLocalEntitySuggestionProvider } from '../lib/services/lfm-local-entity-suggestion.service';
import { GlinerLocalEntitySuggestionProvider } from '../lib/services/gliner-local-entity-suggestion.service';
import type {
    EntitySuggestionProviderApi,
    EntitySuggestionProviderId,
    EntitySuggestionProviderStatus,
    EntitySuggestionScanRequest,
    LocalEntitySuggestion,
} from '../lib/entity-suggestions/entity-suggestion.types';
import {
    isLikelyJunkEntityLabel,
    mapConfidenceLevelToScore,
    mapScoreToConfidenceLevel,
    normalizeSuggestedEntityKind,
} from '../lib/entity-suggestions/lfm-local-entity-utils';
import {
    filterRejectedSuggestions,
    recordSuggestionAccepted,
    recordSuggestionRejected,
} from '../lib/entity-learning/entity-feedback';

class PhoenixScanEntitySuggestionProvider implements EntitySuggestionProviderApi {
    readonly id = 'fst' as const;

    constructor(private readonly phoenixUiApi: PhoenixUiApiService) {}

    async scan(request: EntitySuggestionScanRequest): Promise<LocalEntitySuggestion[]> {
        const rawSuggestions = await this.phoenixUiApi.scanDiscovery(request.plainText);
        if (!Array.isArray(rawSuggestions) || !rawSuggestions.length) {
            return [];
        }

        const deduped = coalesceDiscoveryCandidates(
            rawSuggestions.map((suggestion) => ({
                ...suggestion,
                key: suggestion.key || normalizeSuggestionKey(suggestion.token),
            })) as PhoenixDiscoveryCandidate[],
        );

        return deduped
            .filter((candidate) => {
                const isKnown = smartGraphRegistry.isRegisteredEntity(candidate.token);
                const isPromoted = Number(candidate.status || 0) === 1;
                return !isKnown && !isPromoted;
            })
            .map((candidate) => ({
                label: candidate.token || 'Unknown',
                kind: resolvePhoenixScanKind(candidate, request.plainText),
                confidence: mapScoreToConfidenceLevel(Number(candidate.score || 0.8)),
                rawScore: Number(candidate.score || 0.8),
                reasoning: '',
                evidence: '',
                aliases: [],
            }));
    }

    async getStatus(): Promise<EntitySuggestionProviderStatus> {
        return {
            ready: true,
            loading: false,
            device: null,
        };
    }

    async dispose(): Promise<void> {
        return;
    }
}

const PERSON_LIKE_ACTIONS = [
    'said', 'says', 'asked', 'asks', 'answered', 'answers', 'replied', 'replies',
    'murmured', 'whispered', 'called', 'shouted', 'laughed', 'smiled', 'sighed',
    'huffed', 'glanced', 'looked', 'watched', 'turned', 'lifted', 'rolled',
    'stood', 'sat', 'walked', 'moved', 'held', 'gave', 'took',
];

function resolvePhoenixScanKind(candidate: PhoenixDiscoveryCandidate, text: string): string {
    const normalized = normalizeSuggestedEntityKind(String(candidate.kind || 'UNKNOWN'));
    if (normalized !== 'UNKNOWN' && normalized !== 'OTHER') {
        return normalized;
    }

    const label = String(candidate.token || '').trim();
    if (isLikelyCharacterName(label, text)) {
        return 'CHARACTER';
    }

    return normalized;
}

function isLikelyCharacterName(label: string, text: string): boolean {
    if (!/^[\p{Lu}][\p{L}'-]{1,31}$/u.test(label)) {
        return false;
    }

    const escaped = escapeRegExp(label);
    const actionPattern = PERSON_LIKE_ACTIONS.join('|');
    const actorPattern = new RegExp(
        `\\b${escaped}\\b(?:\\s+\\w+){0,2}\\s+(${actionPattern})\\b|\\b(${actionPattern})\\s+(?:\\w+\\s+){0,2}\\b${escaped}\\b`,
        'iu',
    );
    if (actorPattern.test(text)) {
        return true;
    }

    const mentions = text.match(new RegExp(`\\b${escaped}\\b`, 'gu'))?.length ?? 0;
    return mentions >= 2;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSuggestionKey(value: string): string {
    return String(value || '')
        .trim()
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ');
}

export interface NerSuggestion {
    id: string;
    label: string;
    kind: string;
    confidence: number;
    context?: string;
    llmEnhanced?: boolean;
    llmReasoning?: string;
    source: EntitySuggestionProviderId;
}

@Injectable({
    providedIn: 'root'
})
export class NerService {
    private phoenixUiApi = inject(PhoenixUiApiService);
    private noteStore = inject(NoteEditorStore);
    private lfmLocalProvider = inject(LfmLocalEntitySuggestionProvider);
    private glinerLocalProvider = inject(GlinerLocalEntitySuggestionProvider);
    private fstProvider: EntitySuggestionProviderApi;
    private readonly fstStatus = signal<EntitySuggestionProviderStatus>({
        ready: true,
        loading: false,
        device: null,
    });

    constructor() {
        this.fstProvider = new PhoenixScanEntitySuggestionProvider(this.phoenixUiApi);

        const stored = getSetting<string | null>('ner_fst_enabled', null);
        if (stored !== null) {
            const enabled = stored === 'true';
            this.fstEnabled.set(enabled);
            _globalFstEnabled = enabled;
        }
    }

    readonly suggestions = signal<NerSuggestion[]>([]);
    readonly fstEnabled = signal<boolean>(true);
    readonly isAnalyzing = signal<boolean>(false);
    readonly activeProvider = signal<EntitySuggestionProviderId | null>(null);
    readonly lastSuggestionSource = signal<EntitySuggestionProviderId | null>(null);
    readonly errorMessage = signal<string | null>(null);

    readonly providerStatuses = computed(() => ({
        fst: this.fstStatus(),
        lfm_local_experiment: this.lfmLocalProvider.status(),
        gliner_local: this.glinerLocalProvider.status(),
    }));

    private currentText = '';

    async analyzeNote(text: string) {
        const currentNote = this.noteStore.currentNote();
        await this.runManualScan('fst', {
            noteId: currentNote?.id || 'manual-scan',
            noteTitle: currentNote?.title || 'Untitled Note',
            plainText: text,
        });
    }

    async runManualScan(providerId: EntitySuggestionProviderId, request: EntitySuggestionScanRequest): Promise<void> {
        if (providerId === 'fst' && !this.fstEnabled()) {
            console.log('[NerService] FST disabled, skipping analysis');
            return;
        }

        const plainText = String(request.plainText || '');
        if (!plainText.trim()) {
            this.errorMessage.set('No rendered note text is available to scan.');
            return;
        }

        this.currentText = plainText;
        this.activeProvider.set(providerId);
        this.errorMessage.set(null);
        this.isAnalyzing.set(true);
        this.setProviderStatus(providerId, {
            ...this.getProviderStatus(providerId),
            loading: true,
            error: undefined,
        });

        const previousSuggestions = this.suggestions();
        const provider = this.getProvider(providerId);

        try {
            const providerSuggestions = await provider.scan(request);
            const mapped = this.mapProviderSuggestions(providerSuggestions, providerId);
            const filtered = await filterRejectedSuggestions(mapped, providerId);
            this.suggestions.set(filtered);
            this.lastSuggestionSource.set(providerId);
            this.setProviderStatus(providerId, await provider.getStatus());
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Entity scan failed';
            console.error('[NerService] Analysis failed', error);
            this.errorMessage.set(message);
            this.suggestions.set(previousSuggestions);
            this.setProviderStatus(providerId, {
                ...this.getProviderStatus(providerId),
                loading: false,
                error: message,
            });
        } finally {
            this.isAnalyzing.set(false);
            this.activeProvider.set(null);
        }
    }

    async acceptSuggestion(id: string) {
        const suggestion = this.suggestions().find((entry) => entry.id === id);
        if (!suggestion) {
            return;
        }

        const replacement = `[${suggestion.kind}|${suggestion.label}]`;
        console.log('[NerService] Accepting:', replacement);

        this.suggestions.update((list) => list.filter((entry) => entry.id !== id));

        const currentNote = this.noteStore.currentNote();
        const noteId = currentNote?.id || 'unknown';
        const registration = smartGraphRegistry.registerEntity(
            suggestion.label,
            suggestion.kind as any,
            noteId,
            { source: 'user' }
        );
        await recordSuggestionAccepted({
            entityId: registration.entity.id,
            label: registration.entity.label,
            kind: registration.entity.kind,
            surface: suggestion.label,
            provider: suggestion.source,
            noteId,
            confidence: suggestion.confidence,
            context: suggestion.context,
        }).catch(error => {
            console.warn('[NerService] Failed to record accepted suggestion:', error);
        });
    }

    async rejectSuggestion(id: string) {
        const suggestion = this.suggestions().find((entry) => entry.id === id);
        if (!suggestion) {
            return;
        }

        const currentNote = this.noteStore.currentNote();
        await recordSuggestionRejected({
            label: suggestion.label,
            kind: suggestion.kind,
            surface: suggestion.label,
            provider: suggestion.source,
            noteId: currentNote?.id || 'unknown',
            confidence: suggestion.confidence,
            context: suggestion.context,
        }).catch(error => {
            console.warn('[NerService] Failed to record rejected suggestion:', error);
        });
        this.suggestions.update((list) => list.filter((entry) => entry.id !== id));
    }

    toggleFst(enabled: boolean) {
        this.fstEnabled.set(enabled);
        setSetting('ner_fst_enabled', String(enabled));
        if (!enabled && this.lastSuggestionSource() === 'fst') {
            this.suggestions.set([]);
            this.lastSuggestionSource.set(null);
        }
        _globalFstEnabled = enabled;
        window.dispatchEvent(new CustomEvent('fst-toggle', { detail: { enabled } }));
    }

    getProviderStatus(providerId: EntitySuggestionProviderId): EntitySuggestionProviderStatus {
        if (providerId === 'lfm_local_experiment') {
            return this.lfmLocalProvider.status();
        }
        if (providerId === 'gliner_local') {
            return this.glinerLocalProvider.status();
        }

        return this.fstStatus();
    }

    private getProvider(providerId: EntitySuggestionProviderId): EntitySuggestionProviderApi {
        if (providerId === 'lfm_local_experiment') {
            return this.lfmLocalProvider;
        }
        if (providerId === 'gliner_local') {
            return this.glinerLocalProvider;
        }

        return this.fstProvider;
    }

    private setProviderStatus(providerId: EntitySuggestionProviderId, status: EntitySuggestionProviderStatus): void {
        if (providerId === 'lfm_local_experiment' || providerId === 'gliner_local') {
            return;
        }

        this.fstStatus.set(status);
    }

    private mapProviderSuggestions(
        providerSuggestions: LocalEntitySuggestion[],
        providerId: EntitySuggestionProviderId,
    ): NerSuggestion[] {
        return providerSuggestions
            .filter((suggestion) => !smartGraphRegistry.isRegisteredEntity(suggestion.label))
            .filter((suggestion) => !isLikelyJunkEntityLabel(suggestion.label))
            .map((suggestion) => ({
                id: uuidv4(),
                label: suggestion.label || 'Unknown',
                kind: String(normalizeSuggestedEntityKind(String(suggestion.kind || 'UNKNOWN'))),
                confidence: typeof suggestion.rawScore === 'number'
                    ? suggestion.rawScore
                    : mapConfidenceLevelToScore(suggestion.confidence),
                context: suggestion.evidence || undefined,
                llmEnhanced: providerId !== 'fst',
                llmReasoning: suggestion.reasoning || undefined,
                source: providerId,
            }));
    }
}

let _globalFstEnabled = true;
{
    const stored = getSetting<string | null>('ner_fst_enabled', null);
    if (stored !== null) {
        _globalFstEnabled = stored === 'true';
    }
}

export function isFstEnabled(): boolean {
    return _globalFstEnabled;
}
