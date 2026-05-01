use compact_str::CompactString;
use phoenix_dynamic_ner::{LocalMentionId, MentionPacket};
use phoenix_types::{EntityId, ScopeKey, TextRange};
use serde::{Deserialize, Serialize};
use smallvec::SmallVec;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum CompileStage {
    Surface,
    Mentions,
    Candidates,
    Fusion,
    Relations,
    Events,
    States,
    Claims,
    Patch,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompileStageMask {
    bits: u16,
}

impl CompileStageMask {
    pub const ALL: Self = Self { bits: 0x01ff };
    pub const EVIDENCE_ONLY: Self = Self { bits: 0x0007 };

    #[inline]
    pub const fn empty() -> Self {
        Self { bits: 0 }
    }

    #[inline]
    pub fn with(mut self, stage: CompileStage) -> Self {
        self.bits |= 1 << (stage as u16);
        self
    }

    #[inline]
    pub fn contains(self, stage: CompileStage) -> bool {
        (self.bits & (1 << (stage as u16))) != 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CompilerModelPolicy {
    Never,
    AmbiguousOnly,
    Full,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompilerBudget {
    pub max_mentions: usize,
    pub max_candidate_edges: usize,
    pub max_patch_ops: usize,
    pub model_policy: CompilerModelPolicy,
}

impl Default for CompilerBudget {
    fn default() -> Self {
        Self {
            max_mentions: 16_384,
            max_candidate_edges: 65_536,
            max_patch_ops: 16_384,
            model_policy: CompilerModelPolicy::AmbiguousOnly,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompileRequest {
    pub scope: ScopeKey,
    pub document_id: CompactString,
    pub source_fingerprint: u64,
    pub stages: CompileStageMask,
    pub budget: CompilerBudget,
}

#[derive(Clone, Debug, PartialEq)]
pub enum CandidateTarget {
    KnownEntity(EntityId),
    NewEntity { normalized: CompactString },
    AliasOf(EntityId),
    DeferredReview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateEdgeKind {
    KnownExact,
    KnownAlias,
    SameSurfaceCluster,
    MentionGraphSupport,
    ModelSupport,
    ReviewOnly,
}

#[derive(Clone, Debug)]
pub struct CandidateEdge {
    pub mention_id: LocalMentionId,
    pub target: CandidateTarget,
    pub kind: CandidateEdgeKind,
    pub confidence: f32,
    pub evidence: SmallVec<[TextRange; 2]>,
}

#[derive(Clone, Debug, Default)]
pub struct CandidateGraph {
    pub edges: Vec<CandidateEdge>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvidenceStatus {
    LinkKnown,
    ProposeNew,
    ConfirmAlias,
    NeedsReview,
    Rejected,
}

#[derive(Clone, Debug)]
pub struct CandidateDecision {
    pub mention_id: LocalMentionId,
    pub status: EvidenceStatus,
    pub target: CandidateTarget,
    pub confidence: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimDurability {
    DurableCandidate,
    AttributedClaim,
    Hypothetical,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PatchIntent {
    Preview,
    Commit,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EvidencePatchOp {
    LinkMentionToEntity {
        mention_id: LocalMentionId,
        entity_id: EntityId,
        confidence: f32,
    },
    ProposeEntity {
        mention_id: LocalMentionId,
        normalized: CompactString,
        label: CompactString,
        confidence: f32,
    },
    QueueReview {
        mention_id: LocalMentionId,
        reason: CompactString,
    },
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EvidenceGraphPatch {
    pub ops: Vec<EvidencePatchOp>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CompileSummary {
    pub mentions: usize,
    pub candidate_edges: usize,
    pub decisions: usize,
    pub patch_ops: usize,
}

#[derive(Clone, Debug)]
pub struct EvidenceCompileOutput {
    pub mentions: Vec<MentionPacket>,
    pub candidates: CandidateGraph,
    pub decisions: Vec<CandidateDecision>,
    pub patch: EvidenceGraphPatch,
    pub summary: CompileSummary,
}
