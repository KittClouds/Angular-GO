import { describe, it, expect } from 'vitest';
import { validateWS, validateRO, extractMutationTargets } from './query-validator';

describe('Query Validator', () => {
    describe('RunWS Validation (Strict)', () => {
        it('should allow mutations to ws_* relations', () => {
            const result = validateWS(':put ws_node {node_id, kind}');
            expect(result.valid).toBe(true);
        });

        it('should allow multiple ws_* mutations', () => {
            const result = validateWS(':put ws_node {a} :rm ws_edge {b}');
            expect(result.valid).toBe(true);
        });

        it('should allow :replace on ws_* relations', () => {
            const result = validateWS(':replace ws_node {node_id, kind}');
            expect(result.valid).toBe(true);
        });

        it('should FAIL mutation to non-ws relation', () => {
            const result = validateWS(':put entities {id: "1"}');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Cannot mutate non-workspace relation: entities');
        });

        it('should FAIL mixed mutations (ws + non-ws)', () => {
            // Bypass attempt: mutate ws_node AND entities in one script
            const result = validateWS(':put ws_node {id} :put entities {id}');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Cannot mutate non-workspace relation: entities');
        });

        it('should FAIL schema modifications', () => {
            const result = validateWS(':create ws_hack {id}');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Schema modifications not allowed');
        });

        it('should FAIL index creation attempts', () => {
            const result = validateWS('::index create hack');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Schema modifications not allowed');
        });

        it('should extract targets from :replace', () => {
            const targets = extractMutationTargets(':replace ws_node {a}');
            expect(targets).toContain('ws_node');
        });
    });

    describe('RunRO Validation (Strict)', () => {
        it('should allow pure queries with limit', () => {
            const result = validateRO('?[a] := *rel{a} :limit 10');
            expect(result.valid).toBe(true);
        });

        it('should allow query with integer limit', () => {
            const result = validateRO('?[a] := *rel{a} :limit 100');
            expect(result.valid).toBe(true);
        });

        it('should allow query with variable limit', () => {
            // New feature: :limit $param
            const result = validateRO('?[a] := *rel{a} :limit $limit');
            expect(result.valid).toBe(true);
        });

        it('should FAIL queries without limit (unless indexed)', () => {
            const result = validateRO('?[a] := *rel{a}');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('require :limit');
        });

        it('should allow FTS queries without explicit limit (often effectively limited by k)', () => {
            const result = validateRO('?[id] := ~blocks:fts_idx{id | query: "test"}');
            expect(result.valid).toBe(true);
        });

        it('should allow HNSW queries without explicit limit', () => {
            const result = validateRO('?[id] := ~blocks:hnsw{id | query_vec: [1,2], k: 5}');
            expect(result.valid).toBe(true);
        });

        it('should FAIL any mutation', () => {
            const result = validateRO(':put ws_node {a}');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Mutations not allowed');
        });

        it('should FAIL schema mods in RO', () => {
            const result = validateRO(':create rel {a}');
            expect(result.valid).toBe(false);
        });
    });
});
