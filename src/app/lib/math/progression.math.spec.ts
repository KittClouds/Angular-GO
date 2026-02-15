
import { calculateScaledStat, DEFAULT_PROGRESSION_CONFIG } from './progression.math';

describe('Progression Math Scoped System', () => {

    const BASE_MAX = 100;
    const CONFIG = DEFAULT_PROGRESSION_CONFIG; // K=0.5, P=0.6

    it('should return base value at Level 1', () => {
        const result = calculateScaledStat(BASE_MAX, 1, CONFIG);
        expect(result).toBe(BASE_MAX);
    });

    it('should scale consistently at Level 20 (Early Game)', () => {
        // Expected ~390
        const result = calculateScaledStat(BASE_MAX, 20, CONFIG);
        expect(result).toBeGreaterThan(300);
        expect(result).toBeLessThan(500);
    });

    it('should scale consistently at Level 60 (Mid Game)', () => {
        // Expected ~680
        const result = calculateScaledStat(BASE_MAX, 60, CONFIG);
        expect(result).toBeGreaterThan(600);
        expect(result).toBeLessThan(800);
    });

    it('should scale consistently at Level 100 (Late Game)', () => {
        // Expected ~880
        const result = calculateScaledStat(BASE_MAX, 100, CONFIG);
        expect(result).toBeGreaterThan(800);
        expect(result).toBeLessThan(1000);
    });

    it('should show diminishing returns relative to level', () => {
        // Compare gain from 1->20 vs 80->100 (20 levels each)

        const gainEarly = calculateScaledStat(BASE_MAX, 20, CONFIG) - calculateScaledStat(BASE_MAX, 1, CONFIG);
        const gainLate = calculateScaledStat(BASE_MAX, 100, CONFIG) - calculateScaledStat(BASE_MAX, 80, CONFIG);

        // Early game growth should be significantly faster than late game growth
        expect(gainEarly).toBeGreaterThan(gainLate);
    });
});
