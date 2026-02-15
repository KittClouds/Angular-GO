/**
 * Progression Math Utilities
 * Pure functions for calculating stat scaling based on level.
 * 
 * Formula: ScaledMax = BaseMax * (1 + K * (Level - 1)^P)
 * Checks:
 * - K (Growth Factor): Controls magnitude of multiplier
 * - P (Power): Controls curve shape (diminishing returns if < 1)
 */

export interface ProgressionConfig {
    growthFactor: number; // K
    power: number;        // P
}

export const DEFAULT_PROGRESSION_CONFIG: ProgressionConfig = {
    growthFactor: 0.5,
    power: 0.6
};

/**
 * Calculates a scaled stat value based on level and base value.
 * @param baseValue The value at Level 1
 * @param level The current level (must be >= 1)
 * @param config Optional configuration to override default curve
 * @returns The calculated maximum value for the current level (rounded to nearest integer)
 */
export function calculateScaledStat(
    baseValue: number,
    level: number,
    config: ProgressionConfig = DEFAULT_PROGRESSION_CONFIG
): number {
    // Level 1 is always the baseline
    if (level <= 1) return Math.round(baseValue);

    // K * (L-1)^P
    const multiplier = config.growthFactor * Math.pow(level - 1, config.power);

    // Base * (1 + multiplier)
    const scaled = baseValue * (1 + multiplier);

    return Math.round(scaled);
}
