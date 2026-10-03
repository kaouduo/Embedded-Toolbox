fn main() {
  // The Windows executable icon is embedded by tauri-build. Cargo otherwise
  // may reuse the previous build-script output when only the .ico file changes.
  println!("cargo:rerun-if-changed=icons/icon.ico");
  tauri_build::build()
}
