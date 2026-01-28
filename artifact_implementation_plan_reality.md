# Implementation Plan: GoKitt Reality Layer Parity

## Objective
Refine the GoKitt Reality Layer to achieve functional parity with the Rust reference (`kittcore`), enabling rich semantic graph generation for the Reality Interface.

## Phase 1: Foundations & SVO [COMPLETED]
- [x] **Verb Lexicon Expansion**: Added ~100 verbs + irregular past tenses (said, saw, heard).
- [x] **Graph Serialization**: Fixed `ConceptGraph` to export Edges to JSON.
- [x] **Basic Projection**: Implemented Subject-Verb-Object (SVO) extraction.
- [x] **PP Object Fix**: Resolved issue where objects in prepositional phrases (e.g., "looked at the wizard") were missed.

## Phase 2: QuadPlus & Modifiers [COMPLETED]
- [x] **QuadPlus Structure**: Extended `ConceptEdge` to support `Manner`, `Location`, `Time`, and `Recipient`.
- [x] **Modifier Extraction**: Implemented logic to extract "with [Manner]", "at [Location]", "in [Time]" from unused PrepPhrases.
- [x] **Recipient Detection**: Implemented specific handling for communication verbs ("said to Frodo") to correctly identify indirect objects.
- [x] **POS Mitigation**: Added heuristics to handle misclassified Proper Nouns (e.g., "Frodo" tagged as Verb).

## Phase 3: Advanced Projections (Attribution & StateChange) [COMPLETED]
The goal is to handle complex narrative structures beyond simple physical actions.

### 3.1 Attribution (Speech/Thought Content)
- [x] **Goal**: Capture the *content* of communication/thought (e.g., "Gandalf said *that the ring is dangerous*").
- [x] **Implementation**: 
    - Added `RelMentions` (Reference/Topic).
    - Implemented specific look-ahead for "that" token following communication verbs.
    - Result: `Gandalf --(MENTIONS)--> Ring`.

### 3.2 State Change & Copula
- [x] **Goal**: Handle logic like "The water *froze*", "He *became* a wizard", "The ring *is* dangerous".
- [x] **Implementation**:
    - Added `RelBecomes` and `RelIs` relation types.
    - Added verbs: "become", "turn", "is", "are", "was", "were".
    - **Adjective Support**: Updated `findNearestNPWithContainer` to accept `KindAdjPhrase` and `KindWord` (Adjectives) as targets.
    - Result: `Water --(BECOMES)--> Ice`, `Ring --(IS)--> Dangerous`.

## Phase 4: Optimization & Hardening
- [ ] **Refactor `processSentence`**: Break down the growing monolithic function into `Scanner`, `Classifier`, `Projector` components.
- [ ] **POS Tagger Fixes**: Investigate why `Frodo` is tagged as a Verb in the underlying `chunker.go` / `zipper.go`.
- [ ] **Fuzz Testing**: Run against a larger corpus to identify edge cases.
