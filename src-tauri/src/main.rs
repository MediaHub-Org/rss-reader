#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backups;
mod fetch;
mod url_policy;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

fn main() {
    tauri::Builder::default()
        // A second launch focuses the existing window instead of starting a
        // second WebView (two writers to the same local database).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            fetch::fetch_feed,
            save_text_file,
            open_external,
            backups::list_auto_backups,
            backups::create_auto_backup,
            backups::read_auto_backup,
            backups::delete_auto_backup
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("RSS Reader")
                .inner_size(1200.0, 840.0)
                .min_inner_size(900.0, 600.0)
                .center()
                .resizable(true)
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
