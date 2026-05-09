use std::sync::OnceLock;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
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
    .invoke_handler(tauri::generate_handler![
      get_open_file_path,
      read_csv_file,
      read_binary_file,
      write_text_file,
      write_binary_file,
      get_file_metadata,
      reveal_in_folder,
      open_with_default_app,
      open_external_url,
      geocode,
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

/// Reads a file as raw bytes — used for XLSX and other binary formats
/// where the JS side needs the original byte stream to feed a parser
/// (e.g. SheetJS).
#[tauri::command]
fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Write a UTF-8 string to disk, replacing the file's contents. Used by
/// the "Save Changes to File" flow for CSV exports.
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())
}

/// Write raw bytes to disk, replacing the file's contents. Used by the
/// "Save Changes to File" flow for XLSX exports.
#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &contents).map_err(|e| e.to_string())
}

/// Cross-platform file metadata used by the recent-files list.
#[derive(serde::Serialize)]
struct FileMeta {
    /// Last-modified timestamp in unix milliseconds, if the platform exposes it.
    last_modified_ms: Option<u64>,
    size: u64,
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMeta, String> {
    let m = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let last_modified_ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    Ok(FileMeta {
        last_modified_ms,
        size: m.len(),
    })
}

/// Reveal `path` in the OS file manager (Windows Explorer / macOS Finder),
/// with the file selected. On Linux falls back to opening the parent folder.
#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Explorer expects exactly:  explorer /select,"<absolute-path>"
        //
        // `Command::arg` would quote the whole thing as one literal —
        // Explorer then fails to parse it and silently falls back to
        // opening "Documents". `raw_arg` lets us write the command-line
        // tail verbatim, with our own quotes around the path so spaces
        // and parens (e.g. "tour blanko (1).xlsx") survive
        // CommandLineToArgvW's parser.
        use std::os::windows::process::CommandExt;
        // Strip the UNC long-path prefix if present (`\\?\C:\…`) — Explorer
        // doesn't navigate to UNC paths reliably.
        let cleaned: &str = path
            .strip_prefix(r"\\?\")
            .unwrap_or(path.as_str());
        let arg = format!("/select,\"{}\"", cleaned);
        std::process::Command::new("explorer")
            .raw_arg(&arg)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .ok_or_else(|| "no parent directory".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Open `path` with whichever application the OS has registered as the
/// default for that file type (Excel for .xlsx, Numbers / Excel / etc.
/// for .csv, …). If the app is already open with the file, most modern
/// office suites just focus the existing window.
#[tauri::command]
fn open_with_default_app(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // `cmd /C start "" "<path>"` is the canonical way to ask the OS
        // to invoke the registered handler. The empty quoted string is
        // the (ignored) window-title argument that `start` requires when
        // the next argument is itself quoted.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Open a `http(s)://` URL in the OS default browser. Used by the global
/// click interceptor in the frontend so external links don't navigate
/// the embedded WebView away from the app.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    // Defensive: only allow http/https/mailto. Refuse file:// or arbitrary
    // schemes that could be abused if a hostile CSV ever ended up here.
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("mailto:"))
    {
        return Err(format!("refusing to open scheme: {url}"));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[derive(serde::Deserialize)]
struct NominatimHit {
    lat: String,
    lon: String,
}

#[derive(serde::Serialize)]
struct GeoCoords {
    lat: f64,
    lng: f64,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("TourManager/0.1 (https://github.com/AuchGit/TourManager)")
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build reqwest client")
    })
}

/// Geocode a free-text query via Nominatim. Returns `Ok(None)` when the
/// service responds successfully but with no results (e.g. unknown place).
/// Returns `Err` only on hard transport / decode failures so the caller can
/// distinguish "not found" from "broken" and avoid caching transient errors.
///
/// No artificial throttle: the JS caller already invokes us sequentially
/// (`for await` over CSV rows), and natural network round-trip keeps real
/// throughput well under Nominatim's 1 req/sec ceiling for typical use.
#[tauri::command]
async fn geocode(query: String) -> Result<Option<GeoCoords>, String> {
    let res = http_client()
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[
            ("q", query.as_str()),
            ("format", "json"),
            ("limit", "1"),
        ])
        .header("Accept-Language", "de")
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("nominatim status {}", res.status()));
    }

    let hits: Vec<NominatimHit> = res
        .json()
        .await
        .map_err(|e| format!("decode error: {e}"))?;

    if let Some(first) = hits.first() {
        let lat: f64 = first.lat.parse().map_err(|_| "invalid lat".to_string())?;
        let lng: f64 = first.lon.parse().map_err(|_| "invalid lon".to_string())?;
        Ok(Some(GeoCoords { lat, lng }))
    } else {
        Ok(None)
    }
}
