/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep native/heavy server-only deps out of the webpack bundle — the
    // @resvg native .node addon can't be bundled (used for figure rasterization).
    serverComponentsExternalPackages: ["@neondatabase/serverless", "@resvg/resvg-js"],
  },
};

export default nextConfig;
