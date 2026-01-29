export const NETWORK_RELATIONSHIP_SCHEMA = `
:create network_relationship {
    id: Uuid,
    network_id: Uuid,
    
    source_id: Uuid,
    target_id: Uuid,
    
    relationship_code: String,
    inverse_code: String? default null,
    
    start_date: Float? default null,
    end_date: Float? default null,
    
    strength: Float default 1.0,
    notes: String? default null,
    attributes: Json? default null,
    
    created_at: Float default now(),
    updated_at: Float default now(),
    
    group_id: String,
    scope_type: String default "network",
    confidence: Float default 1.0,
    extraction_methods: [String] default ["network"],
    narrative_id: String
}
`;

export const NETWORK_RELATIONSHIP_QUERIES = {
  upsert: `
    ?[id, network_id, source_id, target_id, relationship_code, inverse_code,
      start_date, end_date, strength, notes, attributes,
      created_at, updated_at, group_id, scope_type, confidence, extraction_methods, narrative_id] <- 
      [[$id, $network_id, $source_id, $target_id, $relationship_code, $inverse_code,
        $start_date, $end_date, $strength, $notes, $attributes,
        $created_at, $updated_at, $group_id, $scope_type, $confidence, $extraction_methods, $narrative_id]]
    :put network_relationship {
      id, network_id, source_id, target_id, relationship_code, inverse_code,
      start_date, end_date, strength, notes, attributes,
      created_at, updated_at, group_id, scope_type, confidence, extraction_methods, narrative_id
    }
  `,

  getByNetworkId: `
    ?[id, network_id, source_id, target_id, relationship_code, inverse_code,
      start_date, end_date, strength, notes, confidence] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code, inverse_code,
        start_date, end_date, strength, notes, confidence},
      network_id == $network_id
  `,

  getBySourceId: `
    ?[id, network_id, source_id, target_id, relationship_code, inverse_code,
      strength, confidence] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code, inverse_code,
        strength, confidence},
      source_id == $source_id
  `,

  getByTargetId: `
    ?[id, network_id, source_id, target_id, relationship_code, inverse_code,
      strength, confidence] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code, inverse_code,
        strength, confidence},
      target_id == $target_id
  `,

  getBetweenEntities: `
    ?[id, network_id, relationship_code, inverse_code, strength, confidence, notes] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code, inverse_code,
        strength, confidence, notes},
      ((source_id == $entity_a && target_id == $entity_b) ||
       (source_id == $entity_b && target_id == $entity_a))
  `,

  getByCode: `
    ?[id, network_id, source_id, target_id, strength, confidence] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code, strength, confidence},
      relationship_code == $code
  `,

  getByNetworkAndCode: `
    ?[id, source_id, target_id, strength, confidence, start_date, end_date] := 
      *network_relationship{id, network_id, source_id, target_id, relationship_code,
        strength, confidence, start_date, end_date},
      network_id == $network_id,
      relationship_code == $code
  `,

  getConnectedEntities: `
    ?[connected_id, relationship_code, strength, direction] := 
      *network_relationship{source_id, target_id, relationship_code, strength, network_id},
      network_id == $network_id,
      source_id == $entity_id,
      connected_id = target_id,
      direction = "outgoing"
    
    ?[connected_id, relationship_code, strength, direction] := 
      *network_relationship{source_id, target_id, relationship_code, strength, network_id},
      network_id == $network_id,
      target_id == $entity_id,
      connected_id = source_id,
      direction = "incoming"
  `,

  delete: `
    ?[id] := id = $id
    :rm network_relationship {id}
  `,

  deleteByNetwork: `
    ?[id] := *network_relationship{id, network_id}, network_id == $network_id
    :rm network_relationship {id}
  `,

  countByNetwork: `
    ?[count] := 
      count = count(id),
      *network_relationship{id, network_id},
      network_id == $network_id
  `,
};
