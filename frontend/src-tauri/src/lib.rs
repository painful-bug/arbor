mod backend;

use tauri::{AppHandle, Manager, Runtime};

// Open a file or URL with the OS default handler.
#[tauri::command]
fn open_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(&path, None).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // ── Native menu bar ──────────────────────────────────────────────────
            // Predefined items map to native OS actions automatically (no on_menu_event needed).
            {
                use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem};

                let app_menu = SubmenuBuilder::new(app, "Arbor")
                    .item(&PredefinedMenuItem::about(app, None, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::services(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::hide(app, None)?)
                    .item(&PredefinedMenuItem::hide_others(app, None)?)
                    .item(&PredefinedMenuItem::show_all(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::quit(app, None)?)
                    .build()?;

                let edit_menu = SubmenuBuilder::new(app, "Edit")
                    .item(&PredefinedMenuItem::undo(app, None)?)
                    .item(&PredefinedMenuItem::redo(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::cut(app, None)?)
                    .item(&PredefinedMenuItem::copy(app, None)?)
                    .item(&PredefinedMenuItem::paste(app, None)?)
                    .item(&PredefinedMenuItem::select_all(app, None)?)
                    .build()?;

                let view_menu = SubmenuBuilder::new(app, "View")
                    .item(&PredefinedMenuItem::fullscreen(app, None)?)
                    .build()?;

                let window_menu = SubmenuBuilder::new(app, "Window")
                    .item(&PredefinedMenuItem::minimize(app, None)?)
                    .item(&PredefinedMenuItem::maximize(app, None)?)
                    .separator()
                    .item(&PredefinedMenuItem::close_window(app, None)?)
                    .build()?;

                let menu = MenuBuilder::new(app)
                    .item(&app_menu)
                    .item(&edit_menu)
                    .item(&view_menu)
                    .item(&window_menu)
                    .build()?;

                app.set_menu(menu)?;
            }

            // ── Backend process ──────────────────────────────────────────────────
            let backend = backend::spawn(app.handle())?;
            app.manage(backend);

            // ── macOS vibrancy (sidebar NSVisualEffect) ──────────────────────────
            // Applied after backend spawns; window is guaranteed ready in setup.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(win) = app.get_webview_window("main") {
                    apply_vibrancy(
                        &win,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    )
                    .expect("apply_vibrancy failed — macOS only");
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![open_path, backend::backend_info])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(backend) = app.try_state::<backend::Backend>() {
                    backend.kill();
                }
            }
        });
}
