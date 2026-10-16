#!/usr/bin/env sh
# Tải thư viện MediaPipe Tasks Vision + model Face Landmarker về máy để self-host (không phụ thuộc CDN).
# Chạy từ thư mục gốc của dự án:  sh scripts/download-assets.sh
# Sau đó mở trang với ?assets=local (hoặc đảo thứ tự nguồn trong js/config.js).
set -eu

VERSION="0.10.35"   # phải khớp MEDIAPIPE_VERSION trong js/config.js
CDN="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}"
MODEL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

mkdir -p vendor/mediapipe/wasm models

fetch() { # url dest
  echo "→ $2"
  curl -fL --retry 3 -o "$2" "$1"
}

fetch "${CDN}/vision_bundle.mjs" vendor/mediapipe/vision_bundle.mjs
for f in vision_wasm_internal.js vision_wasm_internal.wasm \
         vision_wasm_nosimd_internal.js vision_wasm_nosimd_internal.wasm \
         vision_wasm_module_internal.js vision_wasm_module_internal.wasm; do
  fetch "${CDN}/wasm/${f}" "vendor/mediapipe/wasm/${f}"
done
fetch "${MODEL}" models/face_landmarker.task

echo "Xong. Giấy phép: @mediapipe/tasks-vision = Apache-2.0; hãy kiểm tra điều khoản của model trên trang chính thức trước khi dùng thương mại."
