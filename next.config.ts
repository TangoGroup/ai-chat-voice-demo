import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  useLightningCss: false,
  /* config options here */
  headers: async () => {
    return [
      // Enable cross-origin isolation globally
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          // Allow microphone usage (prevent being disabled by an inherited restrictive policy)
          { key: "Permissions-Policy", value: "microphone=(self)" },
        ],
      },
      // Ensure static worklet and model assets are treated as same-origin resources
      {
        source: "/vad-web/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/onnx/:path*",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      // Make sure .wasm files have the correct content type
      {
        source: "/:path*.wasm",
        headers: [
          { key: "Content-Type", value: "application/wasm" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
