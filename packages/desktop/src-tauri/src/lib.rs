// The Rust shell for the Hanzo desktop assistant — the ambient omnipresence layer.
// It is deliberately minimal: it owns the tray/menubar icon, a global hotkey
// (Cmd/Ctrl+Shift+Space) that shows/hides a small always-on-top window, and two
// commands the frontend invokes (hide_window, paste). ALL AI logic lives in the
// frontend (src/*.ts over @hanzo/ai); this crate is the native container only.
//
// Design: one function toggles the window (show_and_focus / toggle_window), one
// place registers the hotkey, one place builds the tray + menu. The tray quick
// actions and the hotkey both emit frontend events so the single run path in
// app.ts serves every surface (DRY across native and web).

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewWindow,
};

// The one window the app has. Referenced by label everywhere so the tray, hotkey,
// and commands all target the same webview.
const MAIN: &str = "main";

// show_and_focus reveals the assistant window, brings it to the front, focuses it,
// and tells the frontend to focus the prompt box for immediate typing. The single
// "bring the assistant up" path — the hotkey and the tray's Open both call it.
fn show_and_focus(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
    // Ask the frontend to focus the prompt input (best-effort; ignored if the page
    // is not ready yet — the autofocus attribute covers the cold-start case).
    let _ = window.emit("focus-prompt", ());
}

// toggle_window is the hotkey behavior: hide the window if it is visible and
// focused, else show and focus it. One obvious toggle so the global shortcut has a
// single, predictable effect.
fn toggle_window(window: &WebviewWindow) {
    let visible = window.is_visible().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(false);
    if visible && focused {
        let _ = window.hide();
    } else {
        show_and_focus(window);
    }
}

// hide_window is invoked by the frontend after a copy-only action (or Esc) to get
// the panel out of the way. A command (not just a JS window.hide) so the same hide
// path is used from Rust and JS.
#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

// paste hides the assistant and synthesizes the platform paste keystroke into the
// now-frontmost app, so a rewrite/fix/translate result (already on the clipboard
// via the frontend) lands where the original text was. Returns Ok even when the OS
// denies synthetic input (e.g. macOS Accessibility not granted) — the text is
// still on the clipboard for a manual paste; the error is logged, not fatal.
#[tauri::command]
fn paste(window: WebviewWindow) -> Result<(), String> {
    // Hide first so the paste lands in the previously-frontmost app, not our panel.
    let _ = window.hide();
    #[cfg(desktop)]
    {
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        // Cmd+V on macOS, Ctrl+V elsewhere.
        #[cfg(target_os = "macos")]
        let modifier = Key::Meta;
        #[cfg(not(target_os = "macos"))]
        let modifier = Key::Control;
        enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(modifier, Direction::Release).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// build_tray creates the menubar/tray icon and its menu: Open, the quick actions
// (each emits `run-action` with its id so the frontend's single run path handles
// it), Settings, and Quit. Left-click on the icon opens the window; the menu is
// the right-click / secondary surface. The quick-action ids MUST match the
// frontend catalog (actions.ts ACTIONS) — the shell only forwards the id.
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let handle = app.handle();

    let open = MenuItem::with_id(app, "open", "Open Hanzo", true, Some("CmdOrCtrl+Shift+Space"))?;
    let summarize = MenuItem::with_id(app, "summarize", "Summarize clipboard", true, None::<&str>)?;
    let rewrite = MenuItem::with_id(app, "rewrite", "Rewrite", true, None::<&str>)?;
    let explain = MenuItem::with_id(app, "explain", "Explain", true, None::<&str>)?;
    let translate = MenuItem::with_id(app, "translate", "Translate", true, None::<&str>)?;
    let fix = MenuItem::with_id(app, "fixGrammar", "Fix grammar", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Hanzo", true, Some("CmdOrCtrl+Q"))?;
    let sep = PredefinedMenuItem::separator(app)?;

    let actions = Submenu::with_id_and_items(
        app,
        "actions",
        "Quick actions",
        true,
        &[&summarize, &rewrite, &explain, &translate, &fix],
    )?;

    let menu = Menu::with_items(app, &[&open, &actions, &sep, &settings, &sep, &quit])?;

    TrayIconBuilder::with_id("hanzo-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Hanzo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let window = app.get_webview_window(MAIN);
            match event.id.as_ref() {
                "open" => {
                    if let Some(w) = &window {
                        show_and_focus(w);
                    }
                }
                "settings" => {
                    if let Some(w) = &window {
                        show_and_focus(w);
                        // The frontend opens the settings pane on this signal.
                        let _ = w.emit("run-action", "settings");
                    }
                }
                "quit" => app.exit(0),
                // Any other id is a quick action; show the window and forward the id
                // so the frontend runs it against the clipboard.
                other => {
                    if let Some(w) = &window {
                        show_and_focus(w);
                        let _ = w.emit("run-action", other.to_string());
                    }
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(w) = tray.app_handle().get_webview_window(MAIN) {
                    toggle_window(&w);
                }
            }
        })
        .build(app)?;

    // The handle is kept alive by the app; nothing else to hold.
    let _ = handle;
    Ok(())
}

// register_hotkey wires the global Cmd/Ctrl+Shift+Space to toggle_window. The
// plugin's handler fires on every registered shortcut; we match ours and act only
// on Pressed (not Released) so one keypress is one toggle.
#[cfg(desktop)]
fn register_hotkey(app: &tauri::App) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    // Cmd+Shift+Space on macOS, Ctrl+Shift+Space elsewhere — the modifier the
    // handler compares against.
    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::SHIFT;
    let toggle = Shortcut::new(Some(mods), Code::Space);

    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if shortcut == &toggle && event.state() == ShortcutState::Pressed {
                    if let Some(w) = app.get_webview_window(MAIN) {
                        toggle_window(&w);
                    }
                }
            })
            .build(),
    )?;
    app.global_shortcut().register(toggle)?;
    Ok(())
}

// run is the single Tauri bootstrap: install the clipboard-manager plugin (the
// frontend reads/writes the clipboard through it), set up the tray and hotkey, and
// register the two commands. The window itself (small, always-on-top, hidden on
// blur, no taskbar entry) is declared in tauri.conf.json so the shell code stays
// about behavior, not geometry.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![hide_window, paste])
        .setup(|app| {
            build_tray(app)?;
            #[cfg(desktop)]
            register_hotkey(app)?;

            // Hide the window when it loses focus (spotlight behavior) so the panel
            // never lingers over the app the user switched back to.
            if let Some(window) = app.get_webview_window(MAIN) {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Hanzo desktop application");
}
