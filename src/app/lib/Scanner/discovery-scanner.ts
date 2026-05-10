/**
 * DiscoveryScanner - calls Phoenix native discovery, filters against Registry,
 * and returns new discovery candidates.
 * Replaces NerService.analyzeNote() for the native pipeline path.
 */
import type { PhoenixUiApiService } from '../../services/phoenix-ui-api.service';
import type { DiscoveryCandidate } from '../store/discoveryStore';

export interface DiscoveryFilter {
    /** Check if a token is already a known entity in the registry */
    isRegisteredEntity(token: string): boolean;
}

export interface DiscoveryResult {
    /** Candidates that passed the hard filter (truly unknown) */
    candidates: DiscoveryCandidate[];
    /** Total raw candidates before filtering */
    rawCount: number;
}

export class DiscoveryScanner {
    constructor(
        private readonly phoenixUiApi: PhoenixUiApiService,
        private readonly filter: DiscoveryFilter
    ) { }

    /**
     * Run the discovery (unsupervised NER) pipeline.
     * 1. Calls Phoenix native scanDiscovery()
     * 2. Hard-filters against the registry to reject known entities
     * 3. Returns only truly unknown candidates
     */
    async discover(text: string): Promise<DiscoveryResult> {
        if (!text || text.length === 0) {
            return { candidates: [], rawCount: 0 };
        }

        try {
            const rawCandidates = await this.phoenixUiApi.scanDiscovery(text);

            if (!rawCandidates || !Array.isArray(rawCandidates) || rawCandidates.length === 0) {
                return { candidates: [], rawCount: 0 };
            }

            const rawCount = rawCandidates.length;

            // HARD FILTER: Reject candidates already known in the Registry
            const unknownCandidates = rawCandidates.filter((c: any) => {
                // Status check: 0=Watching, 1=Promoted
                if (c.status !== 0 && c.status !== 1) return false;

                const isKnown = this.filter.isRegisteredEntity(c.token);
                if (isKnown) {
                    console.log(`[DiscoveryScanner:Filter] Rejected '${c.token}' — already in Registry`);
                    return false;
                }
                return true;
            });

            if (unknownCandidates.length > 0) {
                console.log(`[DiscoveryScanner] Found ${unknownCandidates.length} truly unknown candidates (of ${rawCount} raw)`);
            }

            return {
                candidates: unknownCandidates,
                rawCount,
            };
        } catch (e) {
            console.error('[DiscoveryScanner] Discovery scan error:', e);
            return { candidates: [], rawCount: 0 };
        }
    }
}
