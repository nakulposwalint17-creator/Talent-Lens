import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This UI is rendered on the client against the FastAPI backend, so the
  // template's server caching features are not needed.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
