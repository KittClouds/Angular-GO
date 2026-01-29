export const UNIFIED_EDGE_QUERIES = {
  getAllEdges: `
    ?[id, source_id, target_id, edge_type, confidence, sources, group_id, edge_source, narrative_id] := 
      *entity_edge{id, source_id, target_id, edge_type, confidence, extraction_methods, group_id, narrative_id},
      sources = extraction_methods,
      edge_source = "entity_edge"
    
    ?[id, source_id, target_id, edge_type, confidence, sources, group_id, edge_source, narrative_id] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, extraction_methods, group_id, invalid_at, narrative_id},
      is_null(invalid_at),
      source_id = parent_id,
      target_id = child_id,
      sources = extraction_methods,
      edge_source = "folder_hierarchy"
    
    ?[id, source_id, target_id, edge_type, confidence, sources, group_id, edge_source, narrative_id] := 
      *network_relationship{id, source_id, target_id, relationship_code, confidence, extraction_methods, group_id, narrative_id},
      edge_type = relationship_code,
      sources = extraction_methods,
      edge_source = "network_relationship"
  `,

  getEdgesByGroupId: `
    ?[id, source_id, target_id, edge_type, confidence, sources, edge_source] := 
      *entity_edge{id, source_id, target_id, edge_type, confidence, extraction_methods, group_id},
      group_id == $group_id,
      sources = extraction_methods,
      edge_source = "entity_edge"
    
    ?[id, source_id, target_id, edge_type, confidence, sources, edge_source] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, extraction_methods, group_id, invalid_at},
      group_id == $group_id,
      is_null(invalid_at),
      source_id = parent_id,
      target_id = child_id,
      sources = extraction_methods,
      edge_source = "folder_hierarchy"
    
    ?[id, source_id, target_id, edge_type, confidence, sources, edge_source] := 
      *network_relationship{id, source_id, target_id, relationship_code, confidence, extraction_methods, group_id},
      group_id == $group_id,
      edge_type = relationship_code,
      sources = extraction_methods,
      edge_source = "network_relationship"
  `,

  getEdgesByEntity: `
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *entity_edge{id, source_id, target_id, edge_type, confidence, extraction_methods},
      source_id == $entity_id,
      connected_id = target_id,
      direction = "outgoing",
      sources = extraction_methods,
      edge_source = "entity_edge"
    
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *entity_edge{id, source_id, target_id, edge_type, confidence, extraction_methods},
      target_id == $entity_id,
      connected_id = source_id,
      direction = "incoming",
      sources = extraction_methods,
      edge_source = "entity_edge"
    
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, extraction_methods, invalid_at},
      is_null(invalid_at),
      parent_id == $entity_id,
      connected_id = child_id,
      direction = "outgoing",
      sources = extraction_methods,
      edge_source = "folder_hierarchy"
    
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, extraction_methods, invalid_at},
      is_null(invalid_at),
      child_id == $entity_id,
      connected_id = parent_id,
      direction = "incoming",
      sources = extraction_methods,
      edge_source = "folder_hierarchy"
    
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *network_relationship{id, source_id, target_id, relationship_code, confidence, extraction_methods},
      source_id == $entity_id,
      connected_id = target_id,
      edge_type = relationship_code,
      direction = "outgoing",
      sources = extraction_methods,
      edge_source = "network_relationship"
    
    ?[id, connected_id, edge_type, confidence, sources, direction, edge_source] := 
      *network_relationship{id, source_id, target_id, relationship_code, confidence, extraction_methods},
      target_id == $entity_id,
      connected_id = source_id,
      edge_type = relationship_code,
      direction = "incoming",
      sources = extraction_methods,
      edge_source = "network_relationship"
  `,

  getEdgesByType: `
    ?[id, source_id, target_id, confidence, sources, group_id, edge_source] := 
      *entity_edge{id, source_id, target_id, edge_type, confidence, extraction_methods, group_id},
      edge_type == $edge_type,
      sources = extraction_methods,
      edge_source = "entity_edge"
    
    ?[id, source_id, target_id, confidence, sources, group_id, edge_source] := 
      *folder_hierarchy{id, parent_id, child_id, edge_type, confidence, extraction_methods, group_id, invalid_at},
      edge_type == $edge_type,
      is_null(invalid_at),
      source_id = parent_id,
      target_id = child_id,
      sources = extraction_methods,
      edge_source = "folder_hierarchy"
    
    ?[id, source_id, target_id, confidence, sources, group_id, edge_source] := 
      *network_relationship{id, source_id, target_id, relationship_code, confidence, extraction_methods, group_id},
      relationship_code == $edge_type,
      sources = extraction_methods,
      edge_source = "network_relationship"
  `,

  countBySource: `
    entity_count[count] := count = count(id), *entity_edge{id}
    folder_count[count] := count = count(id), *folder_hierarchy{id, invalid_at}, is_null(invalid_at)
    network_count[count] := count = count(id), *network_relationship{id}
    
    ?[edge_source, count] := entity_count[count], edge_source = "entity_edge"
    ?[edge_source, count] := folder_count[count], edge_source = "folder_hierarchy"
    ?[edge_source, count] := network_count[count], edge_source = "network_relationship"
  `,
};
