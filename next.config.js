/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },

  images: {
    domains: ["lh3.googleusercontent.com"],
  },

  // Make lint non-blocking during builds
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Safety net to avoid bundling Node core polyfills in client builds
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        net: false,
        tls: false,
        fs: false,
        child_process: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
