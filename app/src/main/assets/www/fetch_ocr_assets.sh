#!/usr/bin/env bash
set -euo pipefail

OCR_DIR="js/ocr"
mkdir -p "$OCR_DIR"

echo "Downloading offline Tesseract OCR v5 assets into $OCR_DIR..."

curl -fL "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js" -o "$OCR_DIR/tesseract.min.js"
curl -fL "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js" -o "$OCR_DIR/worker.min.js"
curl -fL "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core.wasm.js" -o "$OCR_DIR/tesseract-core.wasm.js"
curl -fL "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd.wasm.js" -o "$OCR_DIR/tesseract-core-simd.wasm.js"
curl -fL "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz" -o "$OCR_DIR/eng.traineddata.gz"

echo "Verifying downloaded files..."
for f in tesseract.min.js worker.min.js tesseract-core.wasm.js tesseract-core-simd.wasm.js eng.traineddata.gz; do
  if [ ! -s "$OCR_DIR/$f" ]; then
    echo "ERROR: $OCR_DIR/$f is missing or empty!"
    exit 1
  fi
  ls -lh "$OCR_DIR/$f"
done

echo "All 5 offline OCR assets verified and ready for APK packaging."
