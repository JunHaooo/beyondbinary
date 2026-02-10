/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@xenova/transformers'],
  },
};

export default nextConfig;
