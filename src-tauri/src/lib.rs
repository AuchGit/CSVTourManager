#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
    .invoke_handler(tauri::generate_handler![
      get_open_file_path,
      read_csv_file,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
/// Returns the file path passed as the first CLI argument, if any.
/// This is how the OS communicates the target file when the user
/// selects "Open With" → your app, or double-clicks an associated file.
#[tauri::command]
fn get_open_file_path() -> Option<String> {
    std::env::args().nth(1)
}
 
/// Reads a file from disk and returns its content as a UTF-8 string.
/// Strips a UTF-8 BOM (written by German Excel) if present.
/// Returns an error string if the file cannot be read or decoded.
#[tauri::command]
fn read_csv_file(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
 
    // Strip UTF-8 BOM (EF BB BF) — written by German Excel UTF-8 exports
    let content = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes[3..].to_vec()
    } else {
        bytes
    };
 
    String::from_utf8(content).map_err(|e| e.to_string())
}
