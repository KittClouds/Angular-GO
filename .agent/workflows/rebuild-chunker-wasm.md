---
description: How to rebuild the phoenix-chunker WASM module
---

# Rebuild phoenix-chunker WASM

## Prerequisites
- Rust with `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`
- wasm-pack: `cargo install wasm-pack`

## Steps

// turbo-all

1. Run tests
```powershell
cargo test -p phoenix-chunker
```

2. Build WASM binary (~18KB)
```powershell
cd rust/phoenix
wasm-pack build crates/phoenix-chunker --target web --release --out-dir ../../../rust/pkg/phoenix-chunker
```

3. Copy to Angular assets
```powershell
Copy-Item "rust/pkg/phoenix-chunker/phoenix_chunker_bg.wasm" "src/assets/wasm/phoenix_chunker.wasm"
Copy-Item "rust/pkg/phoenix-chunker/phoenix_chunker.js" "src/assets/wasm/phoenix_chunker.js"
```

4. Restart dev server if running
```powershell
npm start
```
