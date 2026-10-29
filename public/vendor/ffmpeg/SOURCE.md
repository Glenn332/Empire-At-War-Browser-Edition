# FFmpeg WebAssembly core

Unmodified ES module and WebAssembly binary from the official npm package
`@ffmpeg/core@0.12.10`, licensed GPL-2.0-or-later. See `COPYING.GPLv2`.
No game media is included here.

- Package: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Build source and scripts: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10
- Source archive: https://github.com/ffmpegwasm/ffmpeg.wasm/archive/refs/tags/v0.12.10.tar.gz
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4
- FFmpeg source archive: https://ffmpeg.org/releases/ffmpeg-5.1.4.tar.xz
- The upstream Dockerfile lists all linked library source repositories, versions,
  build scripts and notices: https://github.com/ffmpegwasm/ffmpeg.wasm/blob/v0.12.10/Dockerfile

The single-thread build uses Emscripten 3.1.40. From the upstream source tree,
run `docker buildx build --build-arg FFMPEG_ST=yes -o . .`; the ES module is
exported in `dist/esm`. All linked dependencies and their build recipes are
specified in that Dockerfile and `build/`.

To restore these exact published binaries in this project, run `npm ci` followed
by `npm run vendor`. `tools/vendor.mjs` copies only the published ES module and
Wasm; retain this notice and license alongside them. The decoder runs in a
separate worker and exchanges original input bytes and decoded RGBA frames.
