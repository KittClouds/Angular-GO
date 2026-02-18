# ONNX Fix Applied

The `transformers.js` library uses a specific version of `onnxruntime-web` which includes `asyncify` builds (`.mjs` files).
These files were missing from the top-level `onnxruntime-web` dependency but present in the nested dependency within `@huggingface/transformers`.

## Applied Changes

1.  **Modified `angular.json`**:
    - Changed the `onnxruntime-web` asset source to point to the **nested** dependency:
      `node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist`
    - This ensures `ort-wasm-simd-threaded.asyncify.mjs` and other required files are copied to `src/assets/onnx`.

2.  **Modified `LocalEmbeddingProvider.ts`**:
    - Reverted to standard configuration: `onnx.wasm.wasmPaths = '/assets/onnx/'`.
    - Removed manual file mappings and thread restrictions, as the correct files should now be available.

## Action Required

Please **restart your development server** (`npm start`) for the `angular.json` changes to take effect.
The application should now load the correct `asyncify` enabled WASM runtime.
