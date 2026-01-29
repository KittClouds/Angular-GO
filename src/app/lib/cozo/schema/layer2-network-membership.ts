export const NETWORK_MEMBERSHIP_SCHEMA = `
:create network_membership {
    id: Uuid,
    network_id: Uuid,
    entity_id: Uuid,
    
    role: String? default null,
    joined_at: Float default now(),
    left_at: Float? default null,
    
    is_root: Bool default false,
    depth_level: Int default 0,
    
    created_at: Float default now(),
    updated_at: Float default now(),
    
    group_id: String,
    extraction_methods: [String] default ["network"],
    narrative_id: String
}
`;

export const NETWORK_MEMBERSHIP_QUERIES = {
  upsert: `
    ?[id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods, narrative_id] <- 
      [[$id, $network_id, $entity_id, $role, $joined_at, $left_at,
        $is_root, $depth_level, $created_at, $updated_at, $group_id, $extraction_methods, $narrative_id]]
    :put network_membership {
      id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods, narrative_id
    }
  `,

  getByNetworkId: `
    ?[id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at] := 
      *network_membership{id, network_id, entity_id, role, joined_at, left_at,
        is_root, depth_level, created_at},
      network_id == $network_id,
      is_null(left_at)
  `,

  getByEntityId: `
    ?[id, network_id, entity_id, role, is_root, depth_level] := 
      *network_membership{id, network_id, entity_id, role, is_root, depth_level, left_at},
      entity_id == $entity_id,
      is_null(left_at)
  `,

  getNetworkRoots: `
    ?[id, network_id, entity_id, role, depth_level] := 
      *network_membership{id, network_id, entity_id, role, depth_level, is_root, left_at},
      network_id == $network_id,
      is_root == true,
      is_null(left_at)
  `,

  getActiveMembers: `
    ?[entity_id, role, is_root, depth_level] := 
      *network_membership{entity_id, role, is_root, depth_level, network_id, left_at},
      network_id == $network_id,
      is_null(left_at)
  `,

  updateRole: `
    ?[id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods] := 
      *network_membership{id, network_id, entity_id, _, joined_at, left_at,
        is_root, depth_level, created_at, _, group_id, extraction_methods},
      id == $id,
      role = $role,
      updated_at = $updated_at
    :put network_membership {
      id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods
    }
  `,

  remove: `
    ?[id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods] := 
      *network_membership{id, network_id, entity_id, role, joined_at, _,
        is_root, depth_level, created_at, _, group_id, extraction_methods},
      id == $id,
      left_at = $left_at,
      updated_at = $updated_at
    :put network_membership {
      id, network_id, entity_id, role, joined_at, left_at,
      is_root, depth_level, created_at, updated_at, group_id, extraction_methods
    }
  `,

  hardDelete: `
    ?[id] := id = $id
    :rm network_membership {id}
  `,

  countByNetwork: `
    ?[count] := 
      count = count(entity_id),
      *network_membership{network_id, entity_id, left_at},
      network_id == $network_id,
      is_null(left_at)
  `,
};
