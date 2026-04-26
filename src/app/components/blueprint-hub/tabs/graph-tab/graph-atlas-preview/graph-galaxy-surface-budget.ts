export interface GalaxySurfaceBudget {
    dpr: number;
    backingWidth: number;
    backingHeight: number;
    backingPixels: number;
    backingBytes: number;
}

const BYTES_PER_PIXEL = 4;
const IDLE_PIXEL_BUDGET = 1_250_000;
const ACTIVE_PIXEL_BUDGET = 1_850_000;
const MIN_DPR = 0.82;
const MAX_DPR = 1.25;

export function budgetGalaxySurface(
    cssWidth: number,
    cssHeight: number,
    devicePixelRatio: number,
    active: boolean,
): GalaxySurfaceBudget {
    const width = Math.max(1, Math.floor(cssWidth));
    const height = Math.max(1, Math.floor(cssHeight));
    const budget = active ? ACTIVE_PIXEL_BUDGET : IDLE_PIXEL_BUDGET;
    const budgetDpr = Math.sqrt(budget / Math.max(1, width * height));
    const dpr = clamp(Math.min(devicePixelRatio || 1, MAX_DPR, budgetDpr), MIN_DPR, MAX_DPR);
    const backingWidth = Math.max(1, Math.floor(width * dpr));
    const backingHeight = Math.max(1, Math.floor(height * dpr));
    const backingPixels = backingWidth * backingHeight;

    return {
        dpr,
        backingWidth,
        backingHeight,
        backingPixels,
        backingBytes: backingPixels * BYTES_PER_PIXEL,
    };
}

export function estimateGalaxyResidentBytes(
    canvasBytes: number,
    backdropBytes: number,
): number {
    // Chromium/WebView2 may retain compositor copies in addition to JS-visible backing stores.
    return Math.round((canvasBytes + backdropBytes) * 2.4);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
