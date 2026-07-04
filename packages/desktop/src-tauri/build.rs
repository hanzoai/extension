// Tauri's build script: generates the context (config, capabilities, icons) the
// macro `tauri::generate_context!()` reads at compile time. Standard boilerplate;
// CI runs it as part of `tauri build`.

fn main() {
    tauri_build::build();
}
