# Vite HMR Memory Leak Prevention Plan

## Problem Summary

**Symptom:** Browser memory grows to 794MB+ with hundreds of duplicate `__vite_injectQuery` strings (~12KB each)

**Root Cause:** Long-lived browser tabs accumulate Vite HMR module wrappers that never get garbage collected. This is a known issue with Vite's HMR implementation in Angular 21's dev server.

**Immediate Fix:** Open the app in a **new browser tab** to clear accumulated HMR state.

---

## Prevention Strategies

### Strategy 1: Developer Workflow Documentation ✅ Recommended

**Approach:** Document the issue and best practices for developers.

**Best Practices:**
- Open a fresh browser tab at the start of each dev session
- Close and reopen the tab if memory exceeds 500MB
- Use Chrome DevTools → Memory → Take heap snapshot to monitor
- Avoid keeping dev server tabs open overnight

**Pros:**
- No code changes required
- Preserves HMR benefits during active development
- Simple to implement

**Cons:**
- Relies on developer discipline
- Can be forgotten

---

### Strategy 2: Disable HMR in Development

**Approach:** Add `hmr: false` to [`angular.json`](angular.json) serve configuration.

```json
{
  "serve": {
    "builder": "@angular/build:dev-server",
    "options": {
      "hmr": false,
      "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      }
    }
  }
}
```

**Pros:**
- Eliminates the issue entirely
- No memory accumulation

**Cons:**
- Loses hot module replacement
- Full page reload on every change
- Slower development iteration

---

### Strategy 3: Periodic Auto-Refresh Script

**Approach:** Add a dev-only script that prompts for refresh after extended sessions.

**Implementation:** Add to `main.ts`:

```typescript
// Dev-only: Warn about long sessions
if (isDevMode()) {
  const SESSION_START = Date.now();
  const WARNING_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours
  
  setInterval(() => {
    if (Date.now() - SESSION_START > WARNING_THRESHOLD) {
      console.warn(
        '⚠️ Long dev session detected. Consider refreshing the page to clear HMR memory.'
      );
    }
  }, 30 * 60 * 1000); // Check every 30 minutes
}
```

**Pros:**
- Passive reminder
- Preserves HMR benefits

**Cons:**
- Still requires manual action
- Console warnings can be ignored

---

### Strategy 4: Configure Vite Prebundling ❌ Not Viable

**Investigation Result:** Angular's `prebundle` option only supports `exclude: []`, not `include`. Prebundling is enabled by default and cannot be configured to include specific packages.

**Schema from `@angular/build`:**
```typescript
export type PrebundleClass = {
    exclude: string[];  // Only exclusion is supported
};
```

**Conclusion:** This strategy is not viable with current Angular CLI capabilities.

---

### Strategy 5: Dev Session Monitor ✅ Implemented

**Approach:** Add a dev-only script that monitors session duration and warns about potential HMR memory accumulation.

**Implementation:** Added to [`src/main.ts`](src/main.ts):

```typescript
// Phase 3: Dev Session Monitor (HMR Memory Leak Prevention)
const SESSION_START = Date.now();
const WARNING_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
const CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// Warns in console after 2+ hours
// Exposes __checkHmrMemory() utility for manual checks
```

**Pros:**
- Passive monitoring
- Preserves HMR benefits
- Provides actionable guidance

**Cons:**
- Still requires manual action (refresh/new tab)

---

## Implemented Solution

### ✅ Phase 1: Dev Session Monitor
- Added session duration tracking in [`src/main.ts`](src/main.ts)
- Console warnings after 2 hours of continuous dev
- Manual check via `__checkHmrMemory()` in browser console
- Instructions for checking HMR memory in DevTools

### ✅ Phase 2: Documentation
- This plan document created at [`plans/vite-hmr-memory-leak-prevention.md`](plans/vite-hmr-memory-leak-prevention.md)

---

## Monitoring

To check if the issue is occurring:
1. Open Chrome DevTools → Memory
2. Take a heap snapshot
3. Search for `__vite_injectQuery`
4. If hundreds of instances exist → open a new tab

---

## Related Issues

- [Vite HMR Memory Leak Discussion](https://github.com/vitejs/vite/issues)
- [Angular CLI Vite Dev Server](https://github.com/angular/angular-cli)

---

## Changelog

| Date | Action |
|------|--------|
| 2026-02-09 | Initial plan created from previous agent diagnosis |
