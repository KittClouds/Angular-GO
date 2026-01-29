export const FOLDER_HIERARCHY_SCHEMA = `
:create folder_hierarchy {
    id: Uuid,
    parent_id: Uuid,
    child_id: Uuid,
    
    created_at: Float default now(),
    valid_at: Float default now(),
    invalid_at: Float? default null,
    
    group_id: String,
    scope_type: String default "folder",
    
    edge_type: String default "CONTAINS",
    inverse_type: String default "CONTAINED_BY",
    
    parent_entity_kind: String? default null,
    child_entity_kind: String? default null,
    
    confidence: Float default 1.0,
    extraction_methods: [String] default ["folder_structure"],
    narrative_id: String
}
`;

export const FOLDER_HIERARCHY_QUERIES = {
  upsert: `
    ?[id, parent_id, child_id, created_at, valid_at, invalid_at,
      group_id, scope_type, edge_type, inverse_type,
      parent_entity_kind, child_entity_kind, confidence, extraction_methods, narrative_id] <- 
      [[$id, $parent_id, $child_id, $created_at, $valid_at, $invalid_at,
        $group_id, $scope_type, $edge_type, $inverse_type,
        $parent_entity_kind, $child_entity_kind, $confidence, $extraction_methods, $narrative_id]]
    :put folder_hierarchy {
      id, parent_id, child_id, created_at, valid_at, invalid_at,
      group_id, scope_type, edge_type, inverse_type,
      parent_entity_kind, child_entity_kind, confidence, extraction_methods, narrative_id
    }
  `,

  getByParentId: `
    ?[id, parent_id, child_id, edge_type, inverse_type, 
      child_entity_kind, confidence, extraction_methods] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, inverse_type,
        child_entity_kind, confidence, extraction_methods, invalid_at},
      parent_id == $parent_id,
      is_null(invalid_at)
  `,

  getByChildId: `
    ?[id, parent_id, child_id, edge_type, inverse_type,
      parent_entity_kind, confidence, extraction_methods] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, inverse_type,
        parent_entity_kind, confidence, extraction_methods, invalid_at},
      child_id == $child_id,
      is_null(invalid_at)
  `,

  getAncestors: `
    ancestors[folder_id, ancestor_id, depth] := 
      *folder_hierarchy{parent_id, child_id, invalid_at},
      child_id == $folder_id,
      is_null(invalid_at),
      folder_id = child_id,
      ancestor_id = parent_id,
      depth = 1

    ancestors[folder_id, ancestor_id, depth] := 
      ancestors[_, parent, prev_depth],
      *folder_hierarchy{parent_id, child_id, invalid_at},
      child_id == parent,
      is_null(invalid_at),
      folder_id = $folder_id,
      ancestor_id = parent_id,
      depth = prev_depth + 1

    ?[ancestor_id, depth] := ancestors[$folder_id, ancestor_id, depth]
    :order depth
  `,

  getDescendants: `
    descendants[folder_id, descendant_id, depth] := 
      *folder_hierarchy{parent_id, child_id, invalid_at},
      parent_id == $folder_id,
      is_null(invalid_at),
      folder_id = parent_id,
      descendant_id = child_id,
      depth = 1

    descendants[folder_id, descendant_id, depth] := 
      descendants[_, child, prev_depth],
      *folder_hierarchy{parent_id, child_id, invalid_at},
      parent_id == child,
      is_null(invalid_at),
      folder_id = $folder_id,
      descendant_id = child_id,
      depth = prev_depth + 1

    ?[descendant_id, depth] := descendants[$folder_id, descendant_id, depth]
    :order depth
  `,

  deleteByFolderId: `
    ?[id] := *folder_hierarchy{id, parent_id, child_id},
      (parent_id == $folder_id || child_id == $folder_id)
    :rm folder_hierarchy {id}
  `,

  softDeleteByFolderId: `
    ?[id, parent_id, child_id, created_at, valid_at, invalid_at,
      group_id, scope_type, edge_type, inverse_type,
      parent_entity_kind, child_entity_kind, confidence, extraction_methods] := 
      *folder_hierarchy{id, parent_id, child_id, created_at, valid_at, _,
        group_id, scope_type, edge_type, inverse_type,
        parent_entity_kind, child_entity_kind, confidence, extraction_methods},
      (parent_id == $folder_id || child_id == $folder_id),
      invalid_at = $now
    :put folder_hierarchy {
      id, parent_id, child_id, created_at, valid_at, invalid_at,
      group_id, scope_type, edge_type, inverse_type,
      parent_entity_kind, child_entity_kind, confidence, extraction_methods
    }
  `,

  getAll: `
    ?[id, parent_id, child_id, edge_type, inverse_type, group_id,
      parent_entity_kind, child_entity_kind, confidence] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, inverse_type, group_id,
        parent_entity_kind, child_entity_kind, confidence, invalid_at},
      is_null(invalid_at)
  `,

  getByGroupId: `
    ?[id, parent_id, child_id, edge_type, confidence] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, group_id, invalid_at},
      group_id == $group_id,
      is_null(invalid_at)
  `,
};
