use phoenix_machine::SurfaceCompiler;
use phoenix_types::{ScanArtifact, StructureArtifact, StructureRequest};

pub struct PhoenixStructure {
    compiler: SurfaceCompiler,
}

impl PhoenixStructure {
    pub fn new() -> Self {
        Self {
            compiler: SurfaceCompiler::default(),
        }
    }

    pub fn build(&self, request: &StructureRequest) -> StructureArtifact {
        self.build_parts(&request.text, &request.scan)
    }

    pub fn build_parts(&self, text: &str, scan: &ScanArtifact) -> StructureArtifact {
        self.compiler.build_structure_parts(text, scan)
    }
}

impl Default for PhoenixStructure {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::PhoenixStructure;
    use phoenix_machine::SurfaceCompiler;
    use phoenix_types::{ScopeKey, StructureRequest};

    #[test]
    fn structure_adapter_uses_machine_dependency_syntax() {
        let compiler = SurfaceCompiler::default();
        let structure = PhoenixStructure::new();
        let text = "Luffy gave the map to Zoro.";
        let scan = compiler.compatibility_scan_parts(text, &ScopeKey::default(), &[]);

        let artifact = structure.build(&StructureRequest {
            text: text.to_owned(),
            scan,
        });

        assert_eq!(artifact.sentence_frames.len(), 1);
        assert_eq!(artifact.relations.len(), 1);
        assert!(!artifact.sentence_frames[0].verb_frames.is_empty());
    }
}
