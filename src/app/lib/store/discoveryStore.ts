
import { signal, computed } from '@angular/core';

export interface DiscoveryCandidate {
    token: string;
    count: number;
    status: number; // 0=Watching, 1=Promoted
    kind: string;
    score: number;
}

class DiscoveryStore {
    private candidates = signal<DiscoveryCandidate[]>([]);

    readonly allCandidates = computed(() => this.candidates());
    readonly promoted = computed(() => this.candidates().filter(c => c.status === 1));

    addCandidates(newCandidates: DiscoveryCandidate[]) {
        this.candidates.update(current => {
            const map = new Map(current.map(c => [c.token, c]));

            newCandidates.forEach(nc => {
                map.set(nc.token, nc);
            });

            return Array.from(map.values());
        });
    }

    clear() {
        this.candidates.set([]);
    }
}

export const discoveryStore = new DiscoveryStore();
