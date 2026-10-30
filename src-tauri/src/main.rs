#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backups;
mod fetch;
mod url_policy;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

struct DesktopState {
    close_to_tray: AtomicBool,
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open RSS Reader", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "Refresh feeds", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &refresh, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("RSS Reader")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "refresh" => {
                let _ = app.emit("tray-refresh", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

/// Save text from the web UI through the OS save dialog. Returns false when
/// the user cancels.
#[tauri::command]
async fn save_text_file(name: String, contents: String) -> Result<bool, String> {
    let Some(handle) = rfd::AsyncFileDialog::new()
        .set_file_name(&name)
        .save_file()
        .await
    else {
        return Ok(false);
    };
    let path = handle.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, contents))
        .await
        .map_err(|err| err.to_string())?
        .map_err(|err| err.to_string())?;
    Ok(true)
}

/// Open an http(s) link in the user's default browser instead of navigating the
/// app window. The URL is validated with the same rules as feed fetching.
#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = url_policy::validate_external(&url)?;
    open::that(parsed.as_str()).map_err(|err| err.to_string())
}

#[tauri::command]
fn set_close_to_tray(state: tauri::State<DesktopState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn is_main_window_active(app: tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| {
            let visible = window.is_visible().unwrap_or(false);
            let focused = window.is_focused().unwrap_or(false);
            Some(visible && focused)
        })
        .unwrap_or(false)
}

#[tauri::command]
fn update_tray_unread(app: tauri::AppHandle, unread: u32) {
    if let Some(tray) = app.tray_by_id("main") {
        let text = if unread == 0 {
            "RSS Reader".to_string()
        } else {
            format!("RSS Reader — {unread} unread")
        };
        let _ = tray.set_tooltip(Some(&text));
        #[cfg(target_os = "macos")]
        {
            let _ = tray.set_title(Some(&text));
        }
    }
}

fn main() {
    tauri::Builder::default()
        // A second launch focuses the existing window instead of starting a
        // second WebView (two writers to the same local database).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            fetch::fetch_feed,
            save_text_file,
            open_external,
            set_close_to_tray,
            is_main_window_active,
            update_tray_unread,
            backups::list_auto_backups,
            backups::create_auto_backup,
            backups::read_auto_backup,
            backups::delete_auto_backup
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<DesktopState>();
                if state.close_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            app.manage(DesktopState {
                close_to_tray: AtomicBool::new(false),
            });
            build_tray(app.handle())?;

            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("RSS Reader")
                .inner_size(1200.0, 840.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .resizable(true)
                // Keep timers running while the window is hidden in the tray,
                // so the refresh interval and notifications still work.
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .on_navigation(|url| {
                    // The app may only navigate inside its own origin. Feeds and
                    // external links go through open_external instead.
                    let host = url.host_str().unwrap_or_default();
                    url.scheme() == "tauri"
                        || host == "tauri.localhost"
                        || host == "localhost"
                        || host == "127.0.0.1"
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RSS Reader");
}
