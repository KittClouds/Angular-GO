// src/lib/Scanner/styles.ts
// Entity decoration styles
// Uses CSS variables from entityColorStore for live theming

import type { EntityKind, HighlightMode, DecorationSpan } from './types';
import { getEntityColor, getEntityBgColor, getEntityColorVar, getEntityTextColorVar } from '../store/entityColorStore';

/**
 * LEGACY: Color palette for entity kinds - DEPRECATED
 * Use getEntityColor() instead for live theme updates
 * Kept for backwards compatibility with existing code
 */
export const ENTITY_COLORS: Record<EntityKind, { bg: string; text: string }> = {
  CHARACTER: { bg: '#7c3aed', text: '#ffffff' },  // Purple
  LOCATION: { bg: '#0891b2', text: '#ffffff' },  // Cyan
  ORGANIZATION: { bg: '#db2777', text: '#ffffff' },  // Pink
  ITEM: { bg: '#ca8a04', text: '#000000' },  // Gold
  CONCEPT: { bg: '#0d9488', text: '#ffffff' },  // Teal
  EVENT: { bg: '#ea580c', text: '#ffffff' },  // Orange
  FACTION: { bg: '#dc2626', text: '#ffffff' },  // Red
  CREATURE: { bg: '#16a34a', text: '#ffffff' },  // Green
  NPC: { bg: '#9333ea', text: '#ffffff' },  // Purple-600
  SCENE: { bg: '#2563eb', text: '#ffffff' },  // Blue-600
  ARC: { bg: '#4f46e5', text: '#ffffff' },  // Indigo-600
  ACT: { bg: '#4338ca', text: '#ffffff' },  // Indigo-700
  CHAPTER: { bg: '#3730a3', text: '#ffffff' },  // Indigo-800
  BEAT: { bg: '#312e81', text: '#ffffff' },  // Indigo-900
  TIMELINE: { bg: '#059669', text: '#ffffff' },  // Emerald-600
  NARRATIVE: { bg: '#047857', text: '#ffffff' },  // Emerald-700
  NETWORK: { bg: '#059669', text: '#ffffff' },  // Emerald-600
  CUSTOM: { bg: '#6b7280', text: '#ffffff' },  // Gray
  UNKNOWN: { bg: '#6b7280', text: '#ffffff' },  // Gray
};

/**
 * Wikilink colors (text + underline style)
 */
const WIKILINK_COLOR = '#3b82f6'; // Blue
const WIKILINK_BROKEN = '#ef4444'; // Red

/**
 * Entity ref uses same palette as entities but different default
 */
const ENTITY_REF_COLOR = '#8b5cf6'; // Purple (default for untyped refs)

/**
 * Generate inline CSS for a decoration span
 * Uses CSS variables for entity colors so they update live with ThemeTab
 */
export function getDecorationStyle(span: DecorationSpan, mode: HighlightMode): string {
  if (mode === 'off') return '';

  switch (span.type) {
    case 'entity':
      return getEntityStyle(span.kind || 'UNKNOWN', mode);
    case 'wikilink':
      return getWikilinkStyle(span.resolved !== false, mode);
    case 'entity_ref':
      return getEntityRefStyle(span.kind, span.resolved !== false, mode);
    case 'entity_implicit':
      if (span.resolved === false) {
        return getAmbiguousStyle(mode);
      }
      return getEntityStyle(span.kind || 'UNKNOWN', mode);
    case 'entity_candidate':
      return getCandidateStyle(mode);
    default:
      return '';
  }
}

function getAmbiguousStyle(mode: HighlightMode): string {
  // Gray dashed underline for ambiguous
  if (mode === 'vivid') {
    return `
      border-bottom: 2px dashed #9ca3af; 
      background-color: rgba(156, 163, 175, 0.1);
      cursor: help;
    `;
  }
  return `border-bottom: 2px dashed #9ca3af;`;
}

function getCandidateStyle(mode: HighlightMode): string {
  // Yellow dotted underline for candidates
  if (mode === 'vivid') {
    return `
        border-bottom: 2px dotted #eab308; 
        background-color: rgba(234, 179, 8, 0.1);
        cursor: help;
      `;
  }
  return `border-bottom: 2px dotted #eab308;`;
}

/**
 * Entity style: Solid pill background using CSS variables
 * Uses separate text color variable for foreground
 */
function getEntityStyle(kind: EntityKind, mode: HighlightMode): string {
  const colorVar = getEntityColorVar(kind);
  const textColorVar = getEntityTextColorVar(kind);

  if (mode === 'vivid') {
    return `
      background-color: hsl(var(${colorVar}) / 0.2);
      color: hsl(var(${textColorVar}));
      border: 1px solid hsl(var(${colorVar}) / 0.3);
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 0.9em;
      display: inline;
      white-space: nowrap;
    `;
  }

  // Clean/Subtle mode - unstyled/invisible
  return '';
}

/**
 * Wikilink style: Colored text with underline (NOT a pill)
 */
function getWikilinkStyle(resolved: boolean, mode: HighlightMode): string {
  const color = resolved ? WIKILINK_COLOR : WIKILINK_BROKEN;
  const underline = resolved ? 'solid' : 'dashed';

  if (mode === 'vivid') {
    return `
      color: ${color};
      text-decoration: underline;
      text-decoration-style: ${underline};
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
      cursor: pointer;
      font-weight: 500;
    `;
  }

  // Subtle mode
  return `
    color: ${color};
    text-decoration: underline;
    text-decoration-style: ${underline};
    cursor: pointer;
  `;
}

/**
 * Entity ref style: Solid pill using CSS variables
 */
function getEntityRefStyle(kind: EntityKind | undefined, resolved: boolean, mode: HighlightMode): string {
  if (kind) {
    // Use entity colors if kind is specified
    return getEntityStyle(kind, mode);
  }

  // Default entity ref style (purple pill or gray)
  const color = resolved ? ENTITY_REF_COLOR : '#6b7280';
  // Manually calculated rgba strings for #8b5cf6 (purple) and #6b7280 (gray)
  const bg = resolved ? 'rgba(139, 92, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)';
  const border = resolved ? 'rgba(139, 92, 246, 0.3)' : 'rgba(107, 114, 128, 0.3)';

  if (mode === 'vivid') {
    return `
      background-color: ${bg};
      color: ${color};
      border: 1px solid ${border};
      padding: 1px 6px;
      border-radius: 4px;
      font-weight: 500;
      font-size: 0.9em;
      display: inline;
      white-space: nowrap;
      cursor: pointer;
    `;
  }

  // Subtle mode
  return `border-bottom: 2px solid ${bg}; padding-bottom: 1px; cursor: pointer;`;
}

/**
 * Get CSS class for a decoration span
 */
export function getDecorationClass(span: DecorationSpan): string {
  switch (span.type) {
    case 'entity':
      return `entity-pill entity-${(span.kind || 'unknown').toLowerCase()}`;
    case 'wikilink':
      return `wikilink ${span.resolved === false ? 'wikilink-broken' : ''}`;
    case 'entity_ref':
      return `entity-ref ${span.kind ? `entity-${span.kind.toLowerCase()}` : ''} ${span.resolved === false ? 'entity-ref-broken' : ''}`;
    case 'entity_implicit':
      if (span.resolved === false) {
        return `entity-implicit-ambiguous`;
      }
      return `entity-implicit entity-${(span.kind || 'unknown').toLowerCase()}`;
    case 'entity_candidate':
      return `entity-candidate`;
    default:
      return '';
  }
}

// Legacy export
export function getEntityClass(kind: EntityKind): string {
  return `entity-${kind.toLowerCase()}`;
}
