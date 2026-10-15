import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['postgres'],
  experimental: {
    // Chat exports are routinely tens of megabytes; the 1MB default rejects them.
    // On Vercel the platform caps request bodies at ~4.5MB regardless, so the
    // import panel sends large exports in pieces rather than relying on this.
    serverActions: { bodySizeLimit: '128mb' },
  },
};

export default config;
