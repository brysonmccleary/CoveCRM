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

  allowedDevOrigins: [
    'covecrm.com', // your current tunnel
    'covecrm.com',       // allow future rotating tunnels
    'covecrm.com',            // allow full ngrok.app support too
  ],
};

module.exports = nextConfig;
