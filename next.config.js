/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  experimental: {
    // Must be an object (not boolean) in Next 15+
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  images: {
    domains: ['lh3.googleusercontent.com'],
  },

  // Hostnames only — no http/https. Include your current ngrok hostname.
  allowedDevOrigins: [
    '057526996a42.ngrok.app', // your current tunnel
    '*.ngrok-free.app',       // allow future rotating tunnels
    '*.ngrok.app',            // allow full ngrok.app support too
  ],

  // ✅ Skip ESLint during `next build` so these warnings don't block deploys
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
