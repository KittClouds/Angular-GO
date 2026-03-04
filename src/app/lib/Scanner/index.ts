// src/lib/Scanner/index.ts
// Scanner module - entity detection and decoration

export * from './types';
export * from './pattern-scanner';
export * from './styles';
// export * from './ImplicitScanner'; // DEPRECATED - Using KittCore
export * from './EntityEventBus';
export * from './DeltaScanner';
// export * from './ScanCoordinator';
export * from './scanCoordinatorInstance';

// ── Modular Scanner Pipeline ──
export * from './prosemirror-bridge';
export * from './highlight-scanner';
export * from './discovery-scanner';
export * from './graph-scanner';
export * from './scan-pipeline';
