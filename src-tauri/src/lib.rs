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
      scan_csv_folder,
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

/// One node in the scanned folder tree. Folders with no compatible CSVs
/// (directly or recursively) are pruned out before being returned.
#[derive(serde::Serialize)]
#[serde(tag = "kind")]
enum CsvNode {
  #[serde(rename = "folder")]
  Folder { name: String, path: String, children: Vec<CsvNode> },
  #[serde(rename = "file")]
  File { name: String, path: String },
}

/// Header tokens that mark a CSV as compatible with this app. We only
/// require the load-bearing columns — extra columns and the German
/// equivalents handled in `csv.ts` are still allowed.
fn is_compatible_header_line(line: &str) -> bool {
  // Strip BOM if present, lowercase, split on `;` or `,`.
  let cleaned = line.trim_start_matches('\u{feff}').to_lowercase();
  let cells: Vec<&str> = cleaned
    .split(|c| c == ';' || c == ',')
    .map(|s| s.trim())
    .collect();

  // Must have a date column …
  let has_date = cells.iter().any(|c| matches!(*c, "date" | "datum"));
  // … a city column …
  let has_city = cells.iter().any(|c| matches!(*c, "city" | "ort"));
  // … a postal-code column.
  let has_plz = cells.iter().any(|c| matches!(*c, "postal_code" | "plz"));

  has_date && has_city && has_plz
}

/// Read just the first non-empty line of a file (with BOM strip) and
/// check whether its header matches our schema. Cheap enough to run on
/// every .csv in a folder tree.
fn file_is_compatible_csv(path: &std::path::Path) -> bool {
  use std::io::{BufRead, BufReader};
  let f = match std::fs::File::open(path) {
    Ok(f) => f,
    Err(_) => return false,
  };
  let mut reader = BufReader::new(f);
  let mut buf = String::new();
  for _ in 0..5 {
    buf.clear();
    match reader.read_line(&mut buf) {
      Ok(0) => return false,
      Ok(_) => {
        let trimmed = buf.trim_end_matches(&['\r', '\n'][..]);
        if !trimmed.is_empty() {
          return is_compatible_header_line(trimmed);
        }
      }
      Err(_) => return false,
    }
  }
  false
}

fn scan_dir(dir: &std::path::Path, depth: u32) -> Vec<CsvNode> {
  // Hard cap on recursion depth so an accidental link cycle / deep tree
  // can't lock the UI for minutes.
  if depth > 8 {
    return Vec::new();
  }
  let mut entries: Vec<_> = match std::fs::read_dir(dir) {
    Ok(it) => it.filter_map(Result::ok).collect(),
    Err(_) => return Vec::new(),
  };
  entries.sort_by_key(|e| e.file_name());

  let mut out: Vec<CsvNode> = Vec::new();
  for entry in entries {
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();

    // Skip hidden / system folders.
    if name.starts_with('.') {
      continue;
    }

    let ftype = match entry.file_type() {
      Ok(t) => t,
      Err(_) => continue,
    };

    if ftype.is_dir() {
      let children = scan_dir(&path, depth + 1);
      if !children.is_empty() {
        out.push(CsvNode::Folder {
          name,
          path: path.to_string_lossy().to_string(),
          children,
        });
      }
    } else if ftype.is_file() {
      let is_csv = path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("csv"))
        .unwrap_or(false);
      if is_csv && file_is_compatible_csv(&path) {
        out.push(CsvNode::File {
          name,
          path: path.to_string_lossy().to_string(),
        });
      }
    }
  }
  out
}

/// Walk `root` recursively and return a tree of folders containing
/// compatible CSV files. Folders without (recursive) compatible files
/// are pruned. Returns an empty list if `root` is invalid.
#[tauri::command]
fn scan_csv_folder(root: String) -> Result<Vec<CsvNode>, String> {
  let p = std::path::PathBuf::from(&root);
  if !p.is_dir() {
    return Err(format!("not a directory: {root}"));
  }
  Ok(scan_dir(&p, 0))
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
