//! Automatic local snapshots for the desktop app.
//!
//! The renderer builds the same full-backup JSON used by manual export; this
//! module stores it under the app data directory, rotates the last N files and
//! exposes them to the Backups dialog. Nothing leaves the device.

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PREFIX: &str = "rss-reader-backup-";
const LEGACY_SUFFIX: &str = ".json";
const SUFFIX: &str = ".json.gz";
const MAX_BACKUPS: usize = 7;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupInfo {
    pub name: String,
    pub bytes: u64,
    pub created_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupList {
    pub directory: String,
    pub items: Vec<AutoBackupInfo>,
}

fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("backups"))
        .map_err(|err| err.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Strict name validation: no traversal, only the files this module creates.
fn backup_stamp(name: &str) -> Option<u64> {
    let stamp = name
        .strip_prefix(PREFIX)?
        .strip_suffix(SUFFIX)
        .or_else(|| name.strip_prefix(PREFIX)?.strip_suffix(LEGACY_SUFFIX))?;
    if stamp.is_empty() || !stamp.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    stamp.parse().ok()
}

fn info_for(path: &Path) -> Option<AutoBackupInfo> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    let created_at = backup_stamp(&name)?;
    let bytes = fs::metadata(path).ok()?.len();
    Some(AutoBackupInfo {
        name,
        bytes,
        created_at,
    })
}

/// Newest first.
fn list_in(dir: &Path) -> Vec<AutoBackupInfo> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut items: Vec<AutoBackupInfo> = entries
        .flatten()
        .filter_map(|entry| info_for(&entry.path()))
        .collect();
    items.sort_by_key(|a| std::cmp::Reverse(a.created_at));
    items
}

fn prune(dir: &Path) {
    let mut items = list_in(dir);
    while items.len() > MAX_BACKUPS {
        let oldest = items.pop();
        if let Some(info) = oldest {
            let _ = fs::remove_file(dir.join(&info.name));
        }
    }
}

fn write_to(dir: &Path, contents: &str) -> Result<AutoBackupInfo, String> {
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;

    let mut stamp = now_ms();
    let mut name = format!("{PREFIX}{stamp}{SUFFIX}");
    while dir.join(&name).exists() {
        stamp += 1;
        name = format!("{PREFIX}{stamp}{SUFFIX}");
    }

    let final_path = dir.join(&name);
    let temp_path = dir.join(format!("{name}.tmp"));
    let file = fs::File::create(&temp_path).map_err(|err| err.to_string())?;
    let mut encoder = GzEncoder::new(file, Compression::default());
    encoder
        .write_all(contents.as_bytes())
        .map_err(|err| err.to_string())?;
    encoder.finish().map_err(|err| err.to_string())?;
    fs::rename(&temp_path, &final_path).map_err(|err| {
        let _ = fs::remove_file(&temp_path);
        err.to_string()
    })?;
    prune(dir);

    let bytes = fs::metadata(&final_path)
        .map_err(|err| err.to_string())?
        .len();
    Ok(AutoBackupInfo {
        name,
        bytes,
        created_at: stamp,
    })
}

fn read_named(app: &AppHandle, name: &str) -> Result<String, String> {
    let stamp = backup_stamp(name).ok_or("Invalid backup name.")?;
    let dir = backup_dir(app)?;
    let compressed = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));
    // Prefer the gzip snapshot, but fall back to a legacy plain JSON file saved
    // by an earlier version. Decode based on the file actually read, so a
    // legacy name that resolves to the compressed file still works.
    let is_compressed = compressed.exists();
    let path = if is_compressed {
        compressed
    } else {
        dir.join(format!("{PREFIX}{stamp}{LEGACY_SUFFIX}"))
    };
    let bytes = fs::read(path).map_err(|err| err.to_string())?;
    decode_backup(bytes, is_compressed)
}

fn decode_backup(bytes: Vec<u8>, compressed: bool) -> Result<String, String> {
    if compressed {
        let mut decoder = GzDecoder::new(bytes.as_slice());
        let mut text = String::new();
        decoder
            .read_to_string(&mut text)
            .map_err(|err| err.to_string())?;
        Ok(text)
    } else {
        String::from_utf8(bytes).map_err(|err| err.to_string())
    }
}

fn delete_named(app: &AppHandle, name: &str) -> Result<(), String> {
    let stamp = backup_stamp(name).ok_or("Invalid backup name.")?;
    let dir = backup_dir(app)?;
    let compressed = dir.join(format!("{PREFIX}{stamp}{SUFFIX}"));
    let path = if compressed.exists() {
        compressed
    } else {
        dir.join(format!("{PREFIX}{stamp}{LEGACY_SUFFIX}"))
    };
    fs::remove_file(path).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_auto_backups(app: AppHandle) -> Result<AutoBackupList, String> {
    let dir = backup_dir(&app)?;
    let directory = dir.to_string_lossy().into_owned();
    let items = tauri::async_runtime::spawn_blocking(move || list_in(&dir))
        .await
        .map_err(|err| err.to_string())?;
    Ok(AutoBackupList { directory, items })
}

#[tauri::command]
pub async fn create_auto_backup(
    app: AppHandle,
    contents: String,
) -> Result<AutoBackupInfo, String> {
    if contents.trim().is_empty() {
        return Err("The backup is empty.".into());
    }
    let dir = backup_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || write_to(&dir, &contents))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn read_auto_backup(app: AppHandle, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_named(&app, &name))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn delete_auto_backup(app: AppHandle, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_named(&app, &name))
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "rss-reader-backup-test-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn validates_backup_names() {
        assert_eq!(backup_stamp("rss-reader-backup-123.json.gz"), Some(123));
        assert_eq!(backup_stamp("rss-reader-backup-123.json"), Some(123));
        assert_eq!(backup_stamp("rss-reader-backup-001.json.gz"), Some(1));
        assert_eq!(backup_stamp("../rss-reader-backup-1.json.gz"), None);
        assert_eq!(backup_stamp("rss-reader-backup-1.tmp"), None);
        assert_eq!(backup_stamp("rss-reader-backup-.json.gz"), None);
        assert_eq!(backup_stamp("other-1.json.gz"), None);
    }

    #[test]
    fn writes_and_lists_newest_first() {
        let dir = temp_dir("write");
        let first = write_to(&dir, r#"{"version":2}"#).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = write_to(&dir, r#"{"version":2}"#).unwrap();

        let items = list_in(&dir);
        assert_eq!(items.len(), 2);
        assert!(items[0].created_at >= second.created_at);
        assert!(items[0].created_at >= first.created_at);
        assert!(items.iter().any(|item| item.name == second.name));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_compressed_snapshots_that_round_trip() {
        let dir = temp_dir("gzip");
        let contents = r#"{"version":2,"feeds":[{"title":"A"}]}"#;
        let info = write_to(&dir, contents).unwrap();
        assert!(info.name.ends_with(SUFFIX));
        let bytes = fs::read(dir.join(&info.name)).unwrap();
        // Gzip magic header, and smaller than the source for repetitive JSON.
        assert_eq!(&bytes[..2], &[0x1f, 0x8b]);
        assert_eq!(decode_backup(bytes, true).unwrap(), contents);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_legacy_plain_json_snapshots() {
        let dir = temp_dir("legacy");
        let path = dir.join(format!("{PREFIX}777{LEGACY_SUFFIX}"));
        fs::write(&path, r#"{"version":2}"#).unwrap();
        let info = info_for(&path).unwrap();
        assert_eq!(info.created_at, 777);
        let bytes = fs::read(&path).unwrap();
        assert_eq!(decode_backup(bytes, false).unwrap(), r#"{"version":2}"#);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotates_to_the_newest_limit() {
        let dir = temp_dir("rotate");
        for index in 0..12 {
            fs::write(dir.join(format!("{PREFIX}{}{SUFFIX}", 1_000 + index)), "{}").unwrap();
        }
        prune(&dir);
        let items = list_in(&dir);
        assert_eq!(items.len(), MAX_BACKUPS);
        assert!(items.iter().all(|item| item.created_at >= 1_005));
        let _ = fs::remove_dir_all(&dir);
    }
}
