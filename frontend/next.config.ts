import type { NextConfig } from "next";

// Backend NestJS (xem backend/README.md). Đi qua rewrites để cùng origin với UI:
// cookie refresh `luna_rt` (SameSite=Strict, Path=/api/v1/auth) gửi kèm tự nhiên, không cần CORS.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Nút "N" của Next ở góc dưới che link cuối sidebar.
  devIndicators: false,
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
