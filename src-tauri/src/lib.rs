use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn extract_inputs(app: tauri::AppHandle, path: String) -> Result<Vec<String>, String> {
    let shell = app.shell();
    let output = shell
        .sidecar("extract-inputs")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?
        .args(["--single", &path])
        .output()
        .await
        .map_err(|e| format!("Failed to run sidecar: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("extract-inputs failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let inputs: Vec<String> =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse JSON: {}", e))?;

    Ok(inputs)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![extract_inputs])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
