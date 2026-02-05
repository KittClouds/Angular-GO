// Custom Slider Types and Umbra Presets
// Umbra = color gradient preset from low to high values

export interface UmbraPreset {
    id: string;
    name: string;
    description: string;
    colorLow: string;   // Value near 0
    colorMid: string;   // Value at 50%
    colorHigh: string;  // Value near max
}

// Pre-defined umbra combos for quick styling
export const UMBRA_PRESETS: UmbraPreset[] = [
    {
        id: 'vitals',
        name: 'Vitals',
        description: 'Red → Yellow → Green (classic health bar)',
        colorLow: '#ef4444',   // red-500
        colorMid: '#f59e0b',   // amber-500
        colorHigh: '#22c55e',  // green-500
    },
    {
        id: 'magic',
        name: 'Magic',
        description: 'Blue → Purple → Violet (mana/arcane)',
        colorLow: '#0ea5e9',   // sky-500
        colorMid: '#8b5cf6',   // violet-500
        colorHigh: '#a855f7',  // purple-500
    },
    {
        id: 'corruption',
        name: 'Corruption',
        description: 'Gray → Purple → Black (sanity/dark)',
        colorLow: '#6b7280',   // gray-500
        colorMid: '#7c3aed',   // violet-600
        colorHigh: '#1f2937',  // gray-800
    },
    {
        id: 'fire',
        name: 'Fire',
        description: 'Yellow → Orange → Red (rage/heat)',
        colorLow: '#fbbf24',   // amber-400
        colorMid: '#f97316',   // orange-500
        colorHigh: '#dc2626',  // red-600
    },
    {
        id: 'ice',
        name: 'Ice',
        description: 'White → Cyan → Blue (frost/cold)',
        colorLow: '#e0f2fe',   // sky-100
        colorMid: '#22d3ee',   // cyan-400
        colorHigh: '#0284c7',  // sky-600
    },
    {
        id: 'nature',
        name: 'Nature',
        description: 'Brown → Yellow → Green (growth)',
        colorLow: '#a16207',   // yellow-700
        colorMid: '#84cc16',   // lime-500
        colorHigh: '#16a34a',  // green-600
    },
    {
        id: 'neutral',
        name: 'Neutral',
        description: 'Gray gradient (generic stats)',
        colorLow: '#9ca3af',   // gray-400
        colorMid: '#6b7280',   // gray-500
        colorHigh: '#374151',  // gray-700
    },
    {
        id: 'gold',
        name: 'Gold',
        description: 'Bronze → Gold → Platinum (wealth/xp)',
        colorLow: '#92400e',   // amber-800
        colorMid: '#fbbf24',   // amber-400
        colorHigh: '#fef3c7',  // amber-100
    },
];

/**
 * Get color for a value based on umbra gradient
 * Interpolates between low → mid → high based on percentage
 */
export function getUmbraColor(
    value: number,
    max: number,
    colorLow: string,
    colorMid: string | undefined,
    colorHigh: string
): string {
    const pct = Math.max(0, Math.min(value / max, 1));

    // If no mid color, just lerp between low and high
    if (!colorMid) {
        return lerpColor(colorLow, colorHigh, pct);
    }

    // Two-stage gradient
    if (pct < 0.5) {
        return lerpColor(colorLow, colorMid, pct * 2);
    } else {
        return lerpColor(colorMid, colorHigh, (pct - 0.5) * 2);
    }
}

/**
 * Linear interpolation between two hex colors
 */
function lerpColor(colorA: string, colorB: string, t: number): string {
    const a = hexToRgb(colorA);
    const b = hexToRgb(colorB);

    const r = Math.round(a.r + (b.r - a.r) * t);
    const g = Math.round(a.g + (b.g - a.g) * t);
    const bVal = Math.round(a.b + (b.b - a.b) * t);

    return rgbToHex(r, g, bVal);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    }).join('');
}
