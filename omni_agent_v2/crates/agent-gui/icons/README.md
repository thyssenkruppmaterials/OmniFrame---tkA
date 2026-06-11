# Icons

Placeholder icon directory. Worker D replaces these with the real OmniFrame
brand assets at packaging time:

- `icon.png` — 512×512 transparent PNG used by Tauri's macOS/Linux bundle.
- `icon.ico` — multi-resolution ICO used by the Windows bundle (16, 32, 48, 64, 128, 256).

Until the real assets land, `tauri.conf.json` references these paths so
`tauri::generate_context!()` can resolve them at compile time. Worker D's
mirror script (`Downloads/MacWindowsBridge`) copies the binary icon blobs
straight from `omni_agent/master_icon.ico` (the same icon shipped by the
v1 single-agent EXE — see `omni_agent/build_exe.bat`).

If you want to generate the icons from a source PNG locally, the Tauri CLI
ships a one-shot helper:

```bash
cargo tauri icon path/to/source.png \
  --output crates/agent-gui/icons
```
