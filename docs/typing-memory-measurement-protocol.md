# Typing Memory Measurement Protocol

Use this protocol before calling typing-time memory growth an app leak.

## Primary Run

1. Open a fresh browser tab.
2. Disable extensions for the run, or use an extensions-free profile.
3. Load the same note each time.
4. Keep DevTools closed during the primary measurement.
5. Run three cycles of:
   - 60 seconds of continuous typing
   - 30 seconds idle
6. Record tab memory after each idle window with Chrome Task Manager.

## Diagnostic Run

Only do this if the primary run still ratchets upward.

1. Reopen in a fresh tab.
2. Open DevTools only after the typing scenario is reproducible.
3. Use the Memory panel for attribution, not as the source of truth.
4. If `__vite__injectQuery`, source-map data URLs, or extension scripts dominate the capture, classify that as tooling noise.

## Acceptance Criteria

- In a fresh dev run, cycle 3 should not exceed cycle 2 by more than 40 MB.
- In a production build, cycle 3 should not exceed cycle 2 by more than 20 MB.
- App-owned detached nodes should return to a stable band after idle.

## Dev Telemetry

During development, the editor exposes the latest typing-path telemetry on:

```ts
window.__kittEditorPerf
```

It includes:

- live update count
- snapshot count
- analytics request count
- stale analytics count
- position persist count
- latest plain-text extraction timing
- latest JSON and markdown snapshot timings
- latest analytics request bytes and round-trip timing
