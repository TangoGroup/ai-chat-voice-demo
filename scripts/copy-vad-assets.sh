#!/bin/bash
# Script to copy VAD assets from node_modules to public directory
# Run this after npm install to ensure VAD assets are available

set -e

echo "Copying VAD assets..."

# Create directories
mkdir -p public/vad-web
mkdir -p public/onnx

# Copy model files
echo "Copying model files..."
cp node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx public/vad-web/
cp node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx public/vad-web/
cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js public/vad-web/

# Copy ONNX WASM files
echo "Copying ONNX WASM files..."
find node_modules/onnxruntime-web/dist -name "*.wasm" -exec cp {} public/onnx/ \;

echo "VAD assets copied successfully!"
echo "Files in public/vad-web/:"
ls -lh public/vad-web/
echo ""
echo "Files in public/onnx/:"
ls -lh public/onnx/ | head -5

