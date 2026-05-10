import { Injectable, computed, inject, signal } from '@angular/core';
import {
    coalesceDiscoveryCandidates,
    type PhoenixDiscoveryCandidate,
} from '../lib/phoenix/phoenix-discovery';
import { PhoenixUiApiService } from './phoenix-ui-api.service';
import type { AtlasRichScanCandidateSummary } from './phoenix-ui-api.service';
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
    readonly id = 'dynamic_ner' as const;

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
            .filter((candidate) => isPlausiblePhoenixDiscoveryCandidate(candidate, request.plainText))
            .map((candidate) => ({
                label: cleanPhoenixCandidateLabel(candidate.token) || 'Unknown',
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
    'stood', 'sat', 'walked', 'crossed', 'dragged', 'muttered', 'moved',
    'held', 'gave', 'took',
];

const PHOENIX_DISCOVERY_STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'above', 'absolute', 'absolutely',
    'again', 'all', 'almost', 'also', 'any', 'around',
    'behind', 'better', 'bigger', 'black', 'built', 'but', 'by', 'can',
    'came', 'could', 'did', 'do', 'does', 'down', 'every', 'for', 'from',
    'get', 'got', 'had', 'has', 'have', 'he', 'her', 'here', 'him', 'his',
    'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just',
    'many', 'more', 'no', 'not', 'of', 'off', 'on', 'or', 'our', 'out',
    'over', 'really', 'said', 'same', 'she', 'should', 'so', 'some',
    'still', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
    'they', 'this', 'those', 'through', 'to', 'too', 'under', 'up', 'very',
    'was', 'we', 'well', 'were', 'what', 'when', 'where', 'which', 'who',
    'will', 'with', 'without', 'would', 'you', 'your',
]);

const COMMON_SENTENCE_STARTERS = new Set([
    'all', 'air', 'aye', 'before', 'do', 'everyone', 'hearing', 'life',
    'looks', 'no', 'not', 'only', 'somewhere', 'that', 'then', 'their',
    'they', 'this', 'when', 'well', 'yes',
]);

function resolvePhoenixScanKind(candidate: PhoenixDiscoveryCandidate, text: string): string {
    const normalized = normalizeSuggestedEntityKind(String(candidate.kind || 'UNKNOWN'));
    const label = String(candidate.token || '').trim();
    if (normalized === 'CHARACTER') {
        return isLikelyCharacterName(label, text) ? 'CHARACTER' : 'UNKNOWN';
    }
    if (normalized !== 'UNKNOWN' && normalized !== 'OTHER') {
        return normalized;
    }

    if (isLikelyCharacterName(label, text)) {
        return 'CHARACTER';
    }

    return normalized;
}

function isPlausiblePhoenixDiscoveryCandidate(candidate: PhoenixDiscoveryCandidate, text: string): boolean {
    const label = cleanPhoenixCandidateLabel(candidate.token);
    if (isLikelyJunkEntityLabel(label)) {
        return false;
    }

    const normalized = label.toLocaleLowerCase();
    const words = normalized.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) {
        return false;
    }
    if (words.every((word) => PHOENIX_DISCOVERY_STOPWORDS.has(word))) {
        return false;
    }
    if (words.length > 1 && (
        PHOENIX_DISCOVERY_STOPWORDS.has(words[0]) ||
        PHOENIX_DISCOVERY_STOPWORDS.has(words[words.length - 1])
    )) {
        return false;
    }
    if (words.length === 1 && COMMON_SENTENCE_STARTERS.has(words[0])) {
        return false;
    }

    const kind = normalizeSuggestedEntityKind(String(candidate.kind || 'UNKNOWN'));
    if (kind === 'CHARACTER') {
        return isLikelyCharacterName(label, text);
    }

    if (words.length === 1) {
        return /^[\p{Lu}][\p{L}'-]{1,31}$/u.test(label);
    }

    return words.some((word) => /^[\p{Lu}]/u.test(word));
}

function isLikelyCharacterName(label: string, text: string): boolean {
    if (!/^[\p{Lu}][\p{L}'-]{1,31}$/u.test(label)) {
        return false;
    }
    const normalized = label.toLocaleLowerCase();
    if (PHOENIX_DISCOVERY_STOPWORDS.has(normalized) || COMMON_SENTENCE_STARTERS.has(normalized)) {
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

function cleanPhoenixCandidateLabel(value: string): string {
    return String(value || '')
        .replace(/^["'“”‘’]+|["'“”‘’.,;:!?]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
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
        atlas_surface: this.fstStatus(),
        dynamic_ner: this.fstStatus(),
        fst: this.fstStatus(),
        lfm_local_experiment: this.lfmLocalProvider.status(),
        gliner_local: this.glinerLocalProvider.status(),
    }));

    private currentText = '';

    async analyzeNote(text: string) {
        const currentNote = this.noteStore.currentNote();
        await this.runDynamicScan({
            noteId: currentNote?.id || 'manual-scan',
            noteTitle: currentNote?.title || 'Untitled Note',
            plainText: text,
        });
    }

    async runDynamicScan(request: EntitySuggestionScanRequest): Promise<void> {
        await this.runManualScan('dynamic_ner', request);
    }

    async loadAtlasSurfaceSuggestions(candidates: AtlasRichScanCandidateSummary[]): Promise<void> {
        const mapped = (candidates || [])
            .map((candidate) => {
                const label = cleanPhoenixCandidateLabel(candidate.label || '');
                const candidateText = [candidate.evidence, label].filter(Boolean).join(' ');
                const kind = resolvePhoenixScanKind({
                    key: label,
                    token: label,
                    kind: candidate.kind,
                    score: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
                    count: 1,
                    status: 0,
                }, candidateText);
                return {
                    id: candidate.id || uuidv4(),
                    label: label || 'Unknown',
                    kind,
                    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0.5,
                    context: candidate.evidence || undefined,
                    llmEnhanced: false,
                    llmReasoning: undefined,
                    source: 'atlas_surface' as const,
                };
            })
            .filter((suggestion) => !smartGraphRegistry.isRegisteredEntity(suggestion.label))
            .filter((suggestion) => !isLikelyJunkEntityLabel(suggestion.label))
            .filter((suggestion) => suggestion.kind !== 'UNKNOWN')
            .filter((suggestion) => isPlausiblePhoenixDiscoveryCandidate({
                key: suggestion.label,
                token: suggestion.label,
                kind: suggestion.kind,
                score: suggestion.confidence,
                count: 1,
                status: 0,
            }, suggestion.context || suggestion.label));
        const filtered = await filterRejectedSuggestions(mapped, 'atlas_surface');
        this.suggestions.set(filtered);
        this.lastSuggestionSource.set('atlas_surface');
        this.activeProvider.set(null);
        this.errorMessage.set(null);
        this.isAnalyzing.set(false);
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

    async warmProvider(providerId: EntitySuggestionProviderId): Promise<void> {
        if (providerId === 'gliner_local') {
            await this.glinerLocalProvider.warm();
            return;
        }
        if (providerId === 'lfm_local_experiment') {
            await this.lfmLocalProvider.getStatus();
            return;
        }
        this.setProviderStatus(providerId, { ready: true, loading: false, device: null });
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
            .filter((suggestion) => !isNativeScanProvider(providerId) || isPlausiblePhoenixDiscoveryCandidate({
                key: suggestion.label,
                token: suggestion.label,
                kind: suggestion.kind,
                score: typeof suggestion.rawScore === 'number' ? suggestion.rawScore : mapConfidenceLevelToScore(suggestion.confidence),
                count: 1,
                status: 0,
            }, this.currentText))
            .map((suggestion) => ({
                id: uuidv4(),
                label: suggestion.label || 'Unknown',
                kind: String(normalizeSuggestedEntityKind(String(suggestion.kind || 'UNKNOWN'))),
                confidence: typeof suggestion.rawScore === 'number'
                    ? suggestion.rawScore
                    : mapConfidenceLevelToScore(suggestion.confidence),
                context: suggestion.evidence || undefined,
                llmEnhanced: !isNativeScanProvider(providerId),
                llmReasoning: suggestion.reasoning || undefined,
                source: providerId,
            }));
    }
}

function isNativeScanProvider(providerId: EntitySuggestionProviderId): boolean {
    return providerId === 'atlas_surface' || providerId === 'dynamic_ner' || providerId === 'fst';
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
