import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { preloadBootCache } from './app/lib/core/boot-cache';

// =============================================================================
// Phase 0: Global Polyfills (SYNC - before any async)
// =============================================================================

// Polyfill for Go WASM environment
(window as any).global = window;

// Fix Vue 3 Feature Flags Warning (for @tiptap/vue-3)
(window as any).__VUE_OPTIONS_API__ = true;
(window as any).__VUE_PROD_DEVTOOLS__ = false;
(window as any).__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false;

// Polyfill 'fs' to redirect writes to console (fixes panic masking)
(window as any).fs = {
  constants: {
    O_WRONLY: -1,
    O_RDWR: -1,
    O_CREAT: -1,
    O_TRUNC: -1,
    O_APPEND: -1,
    O_EXCL: -1,
    O_RDONLY: 0,
    O_SYNC: -1
  },
  writeSync(fd: number, buf: Uint8Array) {
    const output = new TextDecoder("utf-8").decode(buf);
    if (fd === 1) console.log(output);
    else console.error(output);
    return buf.length;
  },
  write(fd: number, buf: Uint8Array, offset: number, length: number, position: number | null, callback: (err: Error | null, n: number) => void) {
    if (offset !== 0 || length !== buf.length || position !== null) {
      callback(new Error("not implemented"), 0);
      return;
    }
    const n = this.writeSync(fd, buf);
    callback(null, n);
  },
  open(path: string, flags: any, mode: any, callback: (err: Error | null, fd: number) => void) {
    const err = new Error("not implemented");
    (err as any).code = "ENOSYS";
    callback(err, 0);
  },
  fsync(fd: number, callback: (err: Error | null) => void) { callback(null); },
};

// =============================================================================
// Phase 1: Boot Cache (pre-Angular IndexedDB load)
// =============================================================================

console.log('[Main] Starting application boot...');

// Load critical data from IndexedDB BEFORE Angular boots
// This ensures registry data is available synchronously when components mount
preloadBootCache()
  .then(() => {
    console.log('[Main] Boot cache ready, starting Angular...');

    // =============================================================================
    // Phase 2: Angular Bootstrap
    // =============================================================================
    return bootstrapApplication(AppComponent, appConfig);
  })
  .then((appRef) => {
    // Expose injector globally for non-DI contexts (e.g., registry dictionary rebuild)
    (window as any).__angularInjector = appRef.injector;
    console.log('[Main] Angular bootstrapped, injector exposed');
  })
  .catch((err) => console.error('[Main] Boot failed:', err));
