use hashbrown::{HashMap, HashSet};

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneSettings {
    pub edge_length: f32,
    pub node_distance: f32,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneEntity {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub total_mentions: Option<u32>,
    pub atlas_x: Option<f32>,
    pub atlas_y: Option<f32>,
    pub atlas_z: Option<f32>,
    pub color_hsl: Option<String>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneEdgeRequest {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub r#type: String,
    pub confidence: f32,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneRequest {
    pub entities: Vec<DesktopGalaxySceneEntity>,
    pub edges: Vec<DesktopGalaxySceneEdgeRequest>,
    pub settings: DesktopGalaxySceneSettings,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneEntityRef {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub total_mentions: Option<u32>,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneNode {
    pub entity: DesktopGalaxySceneEntityRef,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub base_x: f32,
    pub base_y: f32,
    pub base_z: f32,
    pub radius: f32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxySceneEdge {
    pub id: String,
    pub source: u32,
    pub target: u32,
    pub r#type: String,
    pub confidence: f32,
    pub alpha: f32,
    pub curve: f32,
    pub flow_offset: f32,
}

#[taurpc::ipc_type]
#[serde(rename_all = "camelCase")]
pub struct DesktopGalaxyScene {
    pub nodes: Vec<DesktopGalaxySceneNode>,
    pub links: Vec<DesktopGalaxySceneEdge>,
}

pub fn compile_scene(request: DesktopGalaxySceneRequest) -> DesktopGalaxyScene {
    let entities = prioritize_entities(request.entities);
    let mut id_to_index = HashMap::with_capacity(entities.len());
    let total = entities.len().max(1) as f32;
    let mut nodes = Vec::with_capacity(entities.len());

    for (index, entity) in entities.into_iter().enumerate() {
        id_to_index.insert(entity.id.clone(), index);
        let seeded = has_atlas_seed(&entity);
        let y = 1.0 - (index as f32 / (total - 1.0).max(1.0)) * 2.0;
        let radial = (1.0 - y * y).max(0.0).sqrt();
        let angle = index as f32 * 2.399_963_1 + stable_unit(&entity.id) * 0.48;
        let kind_bias = stable_unit(&entity.kind) - 0.5;
        let x = if seeded {
            clamp(entity.atlas_x.unwrap_or_default(), -2.25, 2.25)
        } else {
            angle.cos() * radial * 1.05 + kind_bias * 0.18
        };
        let yy = if seeded {
            clamp(entity.atlas_y.unwrap_or_default(), -1.85, 1.85)
        } else {
            y * 0.74 + (stable_unit(&format!("{}:y", entity.id)) - 0.5) * 0.12
        };
        let z = if seeded {
            clamp(entity.atlas_z.unwrap_or_default(), -2.25, 2.25)
        } else {
            angle.sin() * radial * 0.95 + kind_bias * 0.26
        };
        let mentions = entity.total_mentions.unwrap_or(1).max(1) as f32;
        let (r, g, b) = hsl_to_rgb(entity.color_hsl.as_deref().unwrap_or("190 70% 55%"));
        nodes.push(DesktopGalaxySceneNode {
            entity: DesktopGalaxySceneEntityRef {
                id: entity.id,
                label: entity.label,
                kind: entity.kind,
                total_mentions: entity.total_mentions,
            },
            x,
            y: yy,
            z,
            base_x: x,
            base_y: yy,
            base_z: z,
            radius: (2.1 + mentions.sqrt() * 0.32).min(5.8),
            r,
            g,
            b,
        });
    }

    let links = build_links(request.edges, &id_to_index);
    relax_nodes(&mut nodes, &links, &request.settings);
    DesktopGalaxyScene { nodes, links }
}

fn prioritize_entities(
    mut entities: Vec<DesktopGalaxySceneEntity>,
) -> Vec<DesktopGalaxySceneEntity> {
    let max_nodes = if entities.len() > 1200 {
        180
    } else if entities.len() > 640 {
        210
    } else if entities.len() > 320 {
        240
    } else {
        260
    };
    entities.sort_by(|left, right| {
        entity_priority(right)
            .cmp(&entity_priority(left))
            .then_with(|| left.label.cmp(&right.label))
    });
    entities.truncate(max_nodes);
    entities
}

fn entity_priority(entity: &DesktopGalaxySceneEntity) -> u32 {
    let mentions = entity.total_mentions.unwrap_or(1).max(1);
    mentions + if has_atlas_seed(entity) { 100_000 } else { 0 }
}

fn build_links(
    edges: Vec<DesktopGalaxySceneEdgeRequest>,
    id_to_index: &HashMap<String, usize>,
) -> Vec<DesktopGalaxySceneEdge> {
    let max_links = (id_to_index.len() * 5).clamp(180, 900);
    let mut seen = HashSet::with_capacity(edges.len());
    let mut links = Vec::with_capacity(max_links);
    for edge in edges {
        let Some(&source) = id_to_index.get(&edge.source_id) else {
            continue;
        };
        let Some(&target) = id_to_index.get(&edge.target_id) else {
            continue;
        };
        if source == target {
            continue;
        }
        let key = if source < target {
            ((source as u64) << 32) | target as u64
        } else {
            ((target as u64) << 32) | source as u64
        };
        if !seen.insert(key) {
            continue;
        }
        links.push(DesktopGalaxySceneEdge {
            id: edge.id.clone(),
            source: source as u32,
            target: target as u32,
            r#type: edge.r#type,
            confidence: edge.confidence,
            alpha: (0.052 + edge.confidence.max(0.0) * 0.045).min(0.34),
            curve: (stable_unit(&format!("{}:curve", edge.id)) - 0.5) * 1.35,
            flow_offset: stable_unit(&format!("{}:flow", edge.id)),
        });
        if links.len() >= max_links {
            break;
        }
    }
    links
}

fn relax_nodes(
    nodes: &mut [DesktopGalaxySceneNode],
    links: &[DesktopGalaxySceneEdge],
    settings: &DesktopGalaxySceneSettings,
) {
    let count = nodes.len();
    if count < 3 {
        return;
    }
    let mut vx = vec![0.0_f32; count];
    let mut vy = vec![0.0_f32; count];
    let mut vz = vec![0.0_f32; count];
    let target_length = 0.34 + settings.edge_length * 0.84;
    let repel = 0.012 * settings.node_distance;
    let spring = 0.026_f32;
    let ticks = if count > 220 {
        24
    } else if count > 160 {
        32
    } else if count > 96 {
        44
    } else {
        64
    };

    for _ in 0..ticks {
        for link in links {
            let left = link.source as usize;
            let right = link.target as usize;
            let dx = nodes[right].x - nodes[left].x;
            let dy = nodes[right].y - nodes[left].y;
            let dz = nodes[right].z - nodes[left].z;
            let dist = (dx * dx + dy * dy + dz * dz).sqrt().max(0.001);
            let force = (dist - target_length) * spring;
            let fx = dx / dist * force;
            let fy = dy / dist * force;
            let fz = dz / dist * force;
            vx[left] += fx;
            vy[left] += fy;
            vz[left] += fz;
            vx[right] -= fx;
            vy[right] -= fy;
            vz[right] -= fz;
        }

        for left in 0..count {
            for right in (left + 1)..count {
                let dx = nodes[right].x - nodes[left].x;
                let dy = nodes[right].y - nodes[left].y;
                let dz = nodes[right].z - nodes[left].z;
                let dist2 = (dx * dx + dy * dy + dz * dz).max(0.018);
                let force = repel / dist2;
                vx[left] -= dx * force;
                vy[left] -= dy * force;
                vz[left] -= dz * force;
                vx[right] += dx * force;
                vy[right] += dy * force;
                vz[right] += dz * force;
            }
        }

        for index in 0..count {
            let node = &mut nodes[index];
            node.x = clamp(node.x + vx[index], -2.25, 2.25);
            node.y = clamp(node.y + vy[index], -1.85, 1.85);
            node.z = clamp(node.z + vz[index], -2.25, 2.25);
            node.base_x = node.x;
            node.base_y = node.y;
            node.base_z = node.z;
            vx[index] *= 0.72;
            vy[index] *= 0.72;
            vz[index] *= 0.72;
        }
    }
}

fn has_atlas_seed(entity: &DesktopGalaxySceneEntity) -> bool {
    entity.atlas_x.is_some() && entity.atlas_y.is_some() && entity.atlas_z.is_some()
}

fn clamp(value: f32, min: f32, max: f32) -> f32 {
    value.max(min).min(max)
}

fn stable_unit(value: &str) -> f32 {
    let mut hash = 2_166_136_261_u32;
    for byte in value.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash as f32 / u32::MAX as f32
}

fn hsl_to_rgb(raw_hsl: &str) -> (u8, u8, u8) {
    let normalized = raw_hsl.replace('%', "");
    let mut parts = normalized
        .split_whitespace()
        .filter_map(|part| part.parse::<f32>().ok());
    let h = parts.next().unwrap_or(190.0);
    let s = parts.next().unwrap_or(70.0);
    let l = parts.next().unwrap_or(55.0);
    let hue = ((h % 360.0) + 360.0) % 360.0;
    let saturation = clamp(s / 100.0, 0.0, 1.0);
    let lightness = clamp(l / 100.0, 0.0, 1.0);
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let x = chroma * (1.0 - (((hue / 60.0) % 2.0) - 1.0).abs());
    let match_value = lightness - chroma / 2.0;
    let (red, green, blue) = if hue < 60.0 {
        (chroma, x, 0.0)
    } else if hue < 120.0 {
        (x, chroma, 0.0)
    } else if hue < 180.0 {
        (0.0, chroma, x)
    } else if hue < 240.0 {
        (0.0, x, chroma)
    } else if hue < 300.0 {
        (x, 0.0, chroma)
    } else {
        (chroma, 0.0, x)
    };
    (
        ((red + match_value) * 255.0).round() as u8,
        ((green + match_value) * 255.0).round() as u8,
        ((blue + match_value) * 255.0).round() as u8,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compile_scene_dedupes_links_and_returns_finite_nodes() {
        let scene = compile_scene(DesktopGalaxySceneRequest {
            entities: vec![
                entity("a", "Aella", 3),
                entity("b", "Kai", 2),
                entity("c", "Rowan", 1),
            ],
            edges: vec![
                edge("ab1", "a", "b"),
                edge("ab2", "b", "a"),
                edge("bc1", "b", "c"),
            ],
            settings: DesktopGalaxySceneSettings {
                edge_length: 1.0,
                node_distance: 1.0,
            },
        });

        assert_eq!(scene.nodes.len(), 3);
        assert_eq!(scene.links.len(), 2);
        for node in scene.nodes {
            assert!(node.x.is_finite());
            assert!(node.y.is_finite());
            assert!(node.z.is_finite());
            assert!(node.radius >= 2.1);
        }
    }

    fn entity(id: &str, label: &str, mentions: u32) -> DesktopGalaxySceneEntity {
        DesktopGalaxySceneEntity {
            id: id.to_owned(),
            label: label.to_owned(),
            kind: "CHARACTER".to_owned(),
            total_mentions: Some(mentions),
            atlas_x: None,
            atlas_y: None,
            atlas_z: None,
            color_hsl: Some("285 70% 62%".to_owned()),
        }
    }

    fn edge(id: &str, source_id: &str, target_id: &str) -> DesktopGalaxySceneEdgeRequest {
        DesktopGalaxySceneEdgeRequest {
            id: id.to_owned(),
            source_id: source_id.to_owned(),
            target_id: target_id.to_owned(),
            r#type: "COOCCURS".to_owned(),
            confidence: 1.0,
        }
    }
}
