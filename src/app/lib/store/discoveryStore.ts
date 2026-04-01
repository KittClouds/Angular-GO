import { computed, Injectable, inject, signal } from '@angular/core';
import {
    coalesceDiscoveryCandidates,
    normalizeDiscoveryCandidateKey,
    type PhoenixDiscoveryCandidate,
} from '../phoenix/phoenix-discovery';
import { PhoenixStoreService } from '../../services/phoenix-store.service';

export interface DiscoveryCandidate extends PhoenixDiscoveryCandidate {}

@Injectable({ providedIn: 'root' })
export class DiscoveryStore {
    private candidates = signal<DiscoveryCandidate[]>([]);
    private store = inject(PhoenixStoreService);

    readonly allCandidates = computed(() => this.candidates());
    readonly promoted = computed(() => this.candidates().filter((candidate) => candidate.status === 1));

    constructor() {
        this.loadFromBackend();
    }

    private async loadFromBackend() {
        try {
            const maxWait = 5000;
            const startTime = Date.now();
            while (!this.store.isReady && Date.now() - startTime < maxWait) {
                const ready = await this.store.tryInitialize();
                if (ready) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            const list = await this.store.storeListDiscoveryCandidates();
            if (!Array.isArray(list)) {
                console.warn('[DiscoveryStore] storeListDiscoveryCandidates returned non-array:', typeof list, list);
                this.candidates.set([]);
                return;
            }

            const mapped: DiscoveryCandidate[] = list.map((candidate: any) => ({
                key: normalizeDiscoveryCandidateKey(candidate.token),
                token: String(candidate.token || ''),
                count: Number(candidate.count || 0),
                status: Number(candidate.status || 0),
                kind: String(candidate.kind || '0'),
                score: Number(candidate.score || 0),
            }));

            this.candidates.set(coalesceDiscoveryCandidates(mapped));
        } catch (e: any) {
            if (e?.message?.includes('timed out')) {
                console.warn('[DiscoveryStore] Skipping candidates load: No candidates available (timeout)');
            } else {
                console.error('[DiscoveryStore] Failed to load candidates', e);
            }
        }
    }

    addCandidates(newCandidates: DiscoveryCandidate[]) {
        const normalizedIncoming = newCandidates.map((candidate) => ({
            ...candidate,
            key: normalizeDiscoveryCandidateKey(candidate.key || candidate.token),
        }));
        const incomingKeys = new Set(normalizedIncoming.map((candidate) => candidate.key));

        this.candidates.update((current) => {
            const merged = coalesceDiscoveryCandidates([...current, ...normalizedIncoming]);
            const mergedByKey = new Map(merged.map((candidate) => [candidate.key, candidate]));

            for (const key of incomingKeys) {
                const candidate = mergedByKey.get(key);
                if (!candidate) {
                    continue;
                }

                const goCandidate = {
                    token: candidate.token,
                    kind: parseInt(candidate.kind, 10) || 0,
                    score: candidate.score,
                    status: candidate.status,
                    count: candidate.count,
                    lastSeen: Date.now(),
                    firstSeen: Date.now(),
                };
                this.store.storeUpsertDiscoveryCandidate(goCandidate).catch((error) => console.error(error));
            }

            return merged;
        });
    }

    clear() {
        this.candidates.set([]);
    }
}
