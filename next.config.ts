import path from "node:path";
import type { NextConfig } from "next";

const FACE_ASSETS = [
  "./node_modules/@vladmandic/face-api/model/ssd_mobilenetv1_model*",
  "./node_modules/@vladmandic/face-api/model/face_landmark_68_model*",
  "./node_modules/@vladmandic/face-api/model/face_recognition_model*",
  "./node_modules/@tensorflow/tfjs-backend-wasm/dist/*.wasm",
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Face matching runs on the server with TensorFlow.js (WebAssembly backend): load these with
  // plain Node require, and ship the model weights + .wasm binaries with the routes that use them.
  serverExternalPackages: ["@vladmandic/face-api", "@tensorflow/tfjs", "@tensorflow/tfjs-backend-wasm", "sharp"],
  outputFileTracingIncludes: {
    "/": FACE_ASSETS,
    "/admin/**": FACE_ASSETS,
  },
  experimental: {
    serverActions: {
      // Student photo / ID card / selfie uploads go through Server Actions.
      // Vercel caps request bodies at 4.5 MB, so stay under that.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  turbopack: {
    // Pin the root: a stray package-lock.json in the user's home folder confuses auto-detection.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
