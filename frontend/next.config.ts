import type { NextConfig } from "next";
import { securityHeaders } from "./security-headers";

const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          mediaOrigin: process.env.MEDIA_ORIGIN,
          collabOrigin: process.env.COLLAB_ORIGIN,
          isDev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
