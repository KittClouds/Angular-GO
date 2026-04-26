# Phoenixfield Startup

Date: 2026-04-26

This is the clean branch startup note. Phoenix Desktop is a Tauri desktop app backed by the native Phoenix runtime. During active UI work, the desktop shell can point at Angular's local dev feed for hot reload. For standalone validation, build and run the binary directly.

## Fast Dev Loop

Use this when changing Angular, CSS, graph canvas UI, or other frontend surfaces and you want hot reload.

Terminal 1, from `C:\Users\shuga\1kittroot\1code\Angular-build`:

```powershell
node_modules\.bin\ng.cmd serve --host 127.0.0.1 --port 4200
```

Terminal 2:

```powershell
$env:CARGO_TARGET_DIR='G:\phoenix-target-overgraph'
$env:TMP='G:\phoenix-temp'
$env:TEMP='G:\phoenix-temp'
cargo run --manifest-path src-tauri\Cargo.toml --bin phoenix-tauri
```

This is the fast design loop. The Node process is only Angular's dev feed for the Tauri WebView. The app logic is still Phoenix Desktop/native runtime.

## Slow Standalone Binary Path

Use this when you want to prove the rebuilt desktop binary without hot reload.

From `C:\Users\shuga\1kittroot\1code\Angular-build`:

```powershell
$env:CARGO_TARGET_DIR='G:\phoenix-target-overgraph'
$env:TMP='G:\phoenix-temp'
$env:TEMP='G:\phoenix-temp'
node_modules\.bin\ng.cmd build --configuration development
cargo build --manifest-path src-tauri\Cargo.toml --bin phoenix-tauri
Start-Process -FilePath 'G:\phoenix-target-overgraph\debug\phoenix-tauri.exe' -WorkingDirectory 'C:\Users\shuga\1kittroot\1code\Angular-build\src-tauri' -WindowStyle Hidden
```

This path is slower because it rebuilds the frontend bundle and native binary before launch. It should not need a running `ng serve` process.

## Quick Process Check

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='phoenix-tauri.exe'" |
  Select-Object ProcessId,Name,WorkingSetSize,CommandLine |
  Format-List
```

Expected:

- Fast dev loop: one Angular dev-feed `node.exe` plus `phoenix-tauri.exe`.
- Standalone binary: `phoenix-tauri.exe`; no Angular dev-feed process required.

