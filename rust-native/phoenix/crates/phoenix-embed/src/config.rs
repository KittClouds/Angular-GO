use std::path::PathBuf;

use crate::default_embedding_model_root;

const PASSAGE_PREFIX: &str = "passage: ";
const JINA_QUERY_PREFIX: &str = "Query: ";
const JINA_DOCUMENT_PREFIX: &str = "Document: ";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TextEmbeddingProfile {
    Truncate256,
    Native384,
    Native768,
    Native1024,
}

impl Default for TextEmbeddingProfile {
    fn default() -> Self {
        Self::Native384
    }
}

impl TextEmbeddingProfile {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "256" | "256-truncated" | "truncated-256" => Some(Self::Truncate256),
            "384" | "native-384" => Some(Self::Native384),
            "768" | "native-768" | "786" | "native-786" => Some(Self::Native768),
            "1024" | "native-1024" => Some(Self::Native1024),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Truncate256 => "256-truncated",
            Self::Native384 => "384",
            Self::Native768 => "768",
            Self::Native1024 => "1024",
        }
    }

    pub fn target_dim(self) -> usize {
        match self {
            Self::Truncate256 => 256,
            Self::Native384 => 384,
            Self::Native768 => 768,
            Self::Native1024 => 1024,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextEmbeddingPooling {
    #[default]
    Cls,
    LastToken,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextEmbeddingInputPrefix {
    #[default]
    None,
    Passage,
    JinaQuery,
    JinaDocument,
}

impl TextEmbeddingInputPrefix {
    pub(crate) fn text(self) -> &'static str {
        match self {
            Self::None => "",
            Self::Passage => PASSAGE_PREFIX,
            Self::JinaQuery => JINA_QUERY_PREFIX,
            Self::JinaDocument => JINA_DOCUMENT_PREFIX,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrtTextEmbedConfig {
    pub model_root: PathBuf,
    pub batch_size: usize,
    pub max_length: usize,
    pub profile: TextEmbeddingProfile,
    pub prefix_passage: bool,
    pub pooling: TextEmbeddingPooling,
    pub input_prefix: TextEmbeddingInputPrefix,
}

impl Default for OrtTextEmbedConfig {
    fn default() -> Self {
        Self {
            model_root: default_embedding_model_root(),
            batch_size: 12,
            max_length: 512,
            profile: TextEmbeddingProfile::default(),
            prefix_passage: false,
            pooling: TextEmbeddingPooling::default(),
            input_prefix: TextEmbeddingInputPrefix::default(),
        }
    }
}

impl OrtTextEmbedConfig {
    pub fn jina_v5_retrieval_query(model_root: PathBuf) -> Self {
        Self {
            model_root,
            batch_size: 8,
            max_length: 1024,
            profile: TextEmbeddingProfile::Native768,
            prefix_passage: false,
            pooling: TextEmbeddingPooling::LastToken,
            input_prefix: TextEmbeddingInputPrefix::JinaQuery,
        }
    }

    pub fn jina_v5_retrieval_document(model_root: PathBuf) -> Self {
        Self {
            input_prefix: TextEmbeddingInputPrefix::JinaDocument,
            ..Self::jina_v5_retrieval_query(model_root)
        }
    }
}
