# Theme Tab Discovery & Implementation Plan

## Overview
The **Theme Tab** allows users to customize the visual representation of entities within the application. It provides a grid of all available `EntityKind`s (e.g., Character, Location, Fact), allowing separate configuration for:
1.  **Pill Color** (Background/Border): Used for chips, graph nodes, and highlights.
2.  **Text Color** (Foreground): Used for text labels on pills and nodes.

It also includes a **Highlighting Mode** toggle that controls how aggressively entities are highlighted in the editor.

## Reference Architecture (React)
The reference implementation (`ThemeTab.tsx`) relies on two key global stores:

### 1. Entity Color System (`entityColorStore.ts`)
*   **Responsibility**: Manages the mapping of `EntityKind` -> `HSL Color String`.
*   **Mechanism**:
    *   Maintains two maps: `colors` (backgrounds) and `textColors` (foregrounds).
    *   **Sync**: Updates CSS Custom Properties (Variables) on `document.documentElement` (e.g., `--entity-character`, `--entity-character-text`).
    *   **Persistence**: Runtime-only in the reference (resets on reload), but designed to be easily persistable.
    *   **Components**: Exposes `useEntityColors` hook for React components.

### 2. Highlighting System (`highlightingStore.ts`)
*   **Responsibility**: Controls the global highlighting strategy.
*   **Modes**:
    *   `clean`: Minimal highlighting.
    *   `vivid`: Full colorful highlighting (default-ish).
    *   `focus`: Highlights only specific entity types.
    *   `off`: No highlighting.
*   **Persistence**: Saves settings to `localStorage`.

## Angular Implementation Plan

### 1. Services (The Stores)
We need to create two Angular services using Signals for reactivity.

**`src/app/lib/store/entity-color.service.ts`**
*   **State**: `Signal<Record<EntityKind, string>>` for both colors and textColors.
*   **Methods**:
    *   `setColor(kind, hsl)`: Updates state and sets CSS variable.
    *   `setTextColor(kind, hsl)`: Updates state and sets CSS variable.
    *   `reset()`: Reverts to `DEFAULT_ENTITY_COLORS`.
    *   `initialize()`: Called on app startup to apply default CSS variables.

**`src/app/lib/store/highlighting.service.ts`**
*   **State**: `Signal<HighlightSettings>`.
*   **Methods**:
    *   `setMode(mode)`: Updates mode and saves to localStorage.
    *   `toggleFocusKind(kind)`: Updates focused kinds list.
    *   `initialize()`: Loads from localStorage on startup.

### 2. Components

**`src/app/components/blueprint-hub/tabs/theme-tab/theme-tab.component.ts`**
*   **Template**: A grid layout matching the reference.
*   **Logic**:
    *   Injects `EntityColorService`.
    *   Iterates over `ENTITY_KINDS`.
    *   Uses `<input type="color">` for picking.
    *   **Helpers**: Needs `hslToHex` and `hexToHsl` utilities (can be private methods or a shared util).
*   **UI Details**:
    *   Grouped cards with hover effects.
    *   "Preview" badge showing the actual rendered look.
    *   Dual color pickers (Background & Text).

**`src/app/components/ui/highlighting-mode-toggle/highlighting-mode-toggle.component.ts`**
*   **Template**: A Menu (PrimeNG `p-menu` or custom dropdown using generic UI).
*   **Logic**:
    *   Injects `HighlightingService`.
    *   Displays current mode icon + label.
    *   Dropdown allows selection of mode.
    *   If `Focus` mode, shows a multi-select list of Entity Kinds.

## Recommended Files to Create

1.  `src/app/lib/store/entity-color.service.ts`
2.  `src/app/lib/store/highlighting.service.ts`
3.  `src/app/components/blueprint-hub/tabs/theme-tab/theme-tab.component.ts` (and .html, .css)
4.  `src/app/components/ui/highlighting-mode-toggle/highlighting-mode-toggle.component.ts` (and .html, .css)
