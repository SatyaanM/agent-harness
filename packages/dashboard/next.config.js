/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_PROVIDER_ENDPOINT: process.env.PROVIDER_ENDPOINT || 'https://opencode.ai/zen/go/v1',
  },
  transpilePackages: ['@agent-harness/core', 'react-pdf'],
  webpack: (config, { isServer }) => {
    // Handle PDF.js worker
    if (!isServer) {
      config.resolve.alias['pdfjs-dist'] = require.resolve('pdfjs-dist');
    }
    
    // Handle .mjs files from pdfjs-dist
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules\/pdfjs-dist/,
      type: 'javascript/auto',
    });
    
    return config;
  },
};

module.exports = nextConfig;
