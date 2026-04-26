use std::sync::OnceLock;
use std::time::Duration;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
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
