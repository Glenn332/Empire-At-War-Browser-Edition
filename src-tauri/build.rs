fn main() {
    let _ = std::fs::create_dir_all("../dist-app");
    tauri_build::build()
}
