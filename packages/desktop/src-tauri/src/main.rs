// Thin entrypoint. All the shell logic (tray, global shortcut, window toggle, the
// clipboard `paste` command) lives in lib.rs::run so the crate is a library with a
// one-line binary — the Tauri v2 convention. Prevents an extra console window on
// Windows in release.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hanzo_desktop_lib::run();
}
