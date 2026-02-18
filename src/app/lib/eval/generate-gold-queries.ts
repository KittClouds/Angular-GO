// src/app/lib/eval/generate-gold-queries.ts
/**
 * Gold Query Generator Script
 * 
 * This script runs search queries against the RAPTOR index and generates
 * a populated gold queries file with actual chunk IDs from search results.
 * 
 * Usage:
 * 1. First, ingest documents using the RAPTOR eval UI
 * 2. Run this script in the browser console or as a component method
 * 3. Review and manually curate the generated results
 * 4. Replace gold-queries.ts with the output
 */

import { GoldQuery, GOLD_QUERIES } from './gold-queries';
import { RaptorEvalService, RaptorResult, RaptorDocResult } from '../../services/raptor-eval.service';

export interface GeneratedGoldQuery extends GoldQuery {
    // Auto-populated from search results
    autoPopulatedChunks: string[];
    autoPopulatedDocs: string[];
    topResultText?: string; // Preview of top result for manual review
}

/**
 * Generate populated gold queries by running searches and collecting results.
 * 
 * @param raptorService - Initialized RAPTOR service
 * @param k - Number of results to retrieve per query
 * @returns Generated gold queries with populated chunk IDs
 */
export async function generateGoldQueries(
    raptorService: RaptorEvalService,
    k: number = 10,
    onProgress?: (message: string) => void
): Promise<GeneratedGoldQuery[]> {
    const generated: GeneratedGoldQuery[] = [];

    if (onProgress) onProgress(`Generating gold queries for ${GOLD_QUERIES.length} queries...`);

    for (const query of GOLD_QUERIES) {
        // Run search in all modes to collect chunk IDs
        const leafResults = await raptorService.searchLeafOnly(query.query, k);
        const collapsedResults = await raptorService.search(query.query, k);
        const aggregatedResults = await raptorService.searchAggregated(query.query, k);

        // Extract chunk IDs from leaf-only results (most granular)
        const chunkIds = new Set<string>();
        leafResults.forEach(r => {
            const chunkId = (r as RaptorResult).chunkKey || (r as RaptorResult).chunkId;
            if (chunkId) chunkIds.add(chunkId);
        });

        // Extract doc IDs from aggregated results
        const docIds = new Set<string>();
        aggregatedResults.forEach(r => {
            docIds.add((r as RaptorDocResult).docId);
        });

        // Get preview text from top result
        const topResult = leafResults[0] as RaptorResult;
        const topResultText = topResult?.parentText
            ? topResult.parentText.substring(0, 200) + '...'
            : undefined;

        generated.push({
            ...query,
            // Auto-populate expected chunks with top results
            expectedChunks: Array.from(chunkIds).slice(0, 5), // Top 5 chunks
            expectedDocs: Array.from(docIds),
            relevanceGrades: Object.fromEntries(
                Array.from(chunkIds).slice(0, 5).map((id, i) => [
                    id,
                    3 - Math.min(i, 2) // Grade 3, 2, 1 for top 3, then 1 for rest
                ])
            ),
            autoPopulatedChunks: Array.from(chunkIds),
            autoPopulatedDocs: Array.from(docIds),
            topResultText,
        });

        if (onProgress) onProgress(`Processed: ${query.id} - Found ${chunkIds.size} chunks, ${docIds.size} docs`);
    }

    if (onProgress) onProgress(`Generated ${generated.length} gold queries`);
    return generated;
}

/**
 * Convert generated gold queries to TypeScript code.
 */
export function toTypeScriptCode(queries: GeneratedGoldQuery[]): string {
    const lines: string[] = [
        '// src/app/lib/eval/gold-queries.ts',
        '// Gold query set for RAPTOR evaluation - AUTO-GENERATED',
        '// Review and curate manually before use',
        '',
        'export interface GoldQuery {',
        '    id: string;',
        "    query: string;",
        "    category: 'exact' | 'paraphrase' | 'thematic' | 'cross-chapter';",
        '    expectedChunks: string[];',
        '    expectedDocs: string[];',
        '    relevanceGrades: Record<string, number>;',
        '}',
        '',
        'export const GOLD_QUERIES: GoldQuery[] = [',
    ];

    for (const q of queries) {
        lines.push('    {');
        lines.push(`        id: '${q.id}',`);
        lines.push(`        query: '${q.query.replace(/'/g, "\\'")}',`);
        lines.push(`        category: '${q.category}',`);
        lines.push(`        expectedChunks: ${JSON.stringify(q.expectedChunks)},`);
        lines.push(`        expectedDocs: ${JSON.stringify(q.expectedDocs)},`);
        lines.push(`        relevanceGrades: ${JSON.stringify(q.relevanceGrades)},`);
        lines.push('    },');
    }

    lines.push('];');
    lines.push('');
    lines.push('/**');
    lines.push(' * Get a sample of queries for quick testing.');
    lines.push(' */');
    lines.push('export function getSampleQueries(n: number): GoldQuery[] {');
    lines.push('    const categories = ["exact", "paraphrase", "thematic", "cross-chapter"];');
    lines.push('    const perCategory = Math.ceil(n / categories.length);');
    lines.push('    const result: GoldQuery[] = [];');
    lines.push('    for (const cat of categories) {');
    lines.push('        const catQueries = GOLD_QUERIES.filter(q => q.category === cat);');
    lines.push('        result.push(...catQueries.slice(0, perCategory));');
    lines.push('    }');
    lines.push('    return result.slice(0, n);');
    lines.push('}');

    return lines.join('\n');
}

/**
 * Generate a markdown report for manual review.
 */
export function toMarkdownReport(queries: GeneratedGoldQuery[]): string {
    const lines: string[] = [
        '# Gold Query Generation Report',
        '',
        '## Summary',
        '',
        `- Total queries: ${queries.length}`,
        `- Categories: ${[...new Set(queries.map(q => q.category))].join(', ')}`,
        '',
        '## Queries',
        '',
    ];

    for (const q of queries) {
        lines.push(`### ${q.id}: "${q.query}"`);
        lines.push('');
        lines.push(`**Category:** ${q.category}`);
        lines.push('');
        lines.push(`**Expected chunks (${q.expectedChunks.length}):**`);
        lines.push('```json');
        lines.push(JSON.stringify(q.expectedChunks, null, 2));
        lines.push('```');
        lines.push('');
        if (q.topResultText) {
            lines.push(`**Top result preview:**`);
            lines.push('> ' + q.topResultText.replace(/\n/g, '\n> '));
            lines.push('');
        }
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n');
}
