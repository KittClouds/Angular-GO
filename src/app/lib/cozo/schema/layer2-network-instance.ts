export const NETWORK_INSTANCE_SCHEMA = `
:create network_instance {
    id: Uuid,
    
    name: String,
    schema_id: String,
    network_kind: String,
    network_subtype: String? default null,
    
    root_folder_id: Uuid,
    root_entity_id: Uuid? default null,
    
    namespace: String default "default",
    description: String? default null,
    tags: [String] default [],
    
    member_count: Int default 0,
    relationship_count: Int default 0,
    max_depth: Int default 0,
    
    created_at: Float default now(),
    updated_at: Float default now(),
    
    group_id: String,
    scope_type: String default "network",
    narrative_id: String
}
`;

export const NETWORK_INSTANCE_QUERIES = {
  upsert: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace, description, tags,
      member_count, relationship_count, max_depth,
      created_at, updated_at, group_id, scope_type, narrative_id] <- 
      [[$id, $name, $schema_id, $network_kind, $network_subtype,
        $root_folder_id, $root_entity_id, $namespace, $description, $tags,
        $member_count, $relationship_count, $max_depth,
        $created_at, $updated_at, $group_id, $scope_type, $narrative_id]]
    :put network_instance {
      id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace, description, tags,
      member_count, relationship_count, max_depth,
      created_at, updated_at, group_id, scope_type, narrative_id
    }
  `,

  getById: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace, description, tags,
      member_count, relationship_count, max_depth,
      created_at, updated_at, group_id, scope_type] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, root_entity_id, namespace, description, tags,
        member_count, relationship_count, max_depth,
        created_at, updated_at, group_id, scope_type},
      id == $id
  `,

  getByFolderId: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace,
      member_count, relationship_count, max_depth] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, root_entity_id, namespace,
        member_count, relationship_count, max_depth},
      root_folder_id == $folder_id
  `,

  getByKind: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, namespace, member_count, relationship_count] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, namespace, member_count, relationship_count},
      network_kind == $kind
  `,

  getByNamespace: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, member_count, relationship_count] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, member_count, relationship_count, namespace},
      namespace == $namespace
  `,

  getAll: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace,
      member_count, relationship_count, max_depth, created_at] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, root_entity_id, namespace,
        member_count, relationship_count, max_depth, created_at}
  `,

  updateStats: `
    ?[id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace, description, tags,
      member_count, relationship_count, max_depth,
      created_at, updated_at, group_id, scope_type] := 
      *network_instance{id, name, schema_id, network_kind, network_subtype,
        root_folder_id, root_entity_id, namespace, description, tags,
        _, _, _,
        created_at, _, group_id, scope_type},
      id == $id,
      member_count = $member_count,
      relationship_count = $relationship_count,
      max_depth = $max_depth,
      updated_at = $updated_at
    :put network_instance {
      id, name, schema_id, network_kind, network_subtype,
      root_folder_id, root_entity_id, namespace, description, tags,
      member_count, relationship_count, max_depth,
      created_at, updated_at, group_id, scope_type
    }
  `,

  delete: `
    ?[id] := id = $id
    :rm network_instance {id}
  `,
};
