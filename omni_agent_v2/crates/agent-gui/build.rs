// Created and developed by Jai Singh
// build.rs — runs `tauri_build::build()` only when the `gui` feature is
// active. With the feature off (the default for `cargo check --workspace`)
// we skip Tauri's codegen entirely so a macOS dev box without the
// WebView2 toolchain stays linker-clean.

fn main() {
    if std::env::var("CARGO_FEATURE_GUI").is_ok() {
        tauri_build::build();
    }
}

// Created and developed by Jai Singh
