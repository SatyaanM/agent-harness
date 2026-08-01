/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_PROVIDER_ENDPOINT: process.env.PROVIDER_ENDPOINT || 'https://opencode.ai/zen/go/v1',
  },
  transpilePackages: ['@agent-harness/core', 'react-pdf'],
};

module.exports = nextConfig;
