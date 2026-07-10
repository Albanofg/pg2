/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep native/heavy server-only deps out of the webpack bundle — the
    // @resvg native .node addon can't be bundled (used for figure rasterization);
    // mammoth does dynamic requires that webpack chokes on (DOCX text extraction).
    serverComponentsExternalPackages: [
      "@neondatabase/serverless",
      "@resvg/resvg-js",
      "mammoth",
    ],
    // The .docx export rasterizes each figure's SVG with @resvg/resvg-js, which
    // needs a real font file (serverless has ~no system fonts). We read the
    // bundled DejaVu Sans via fs at runtime using a process.cwd()-relative path,
    // which Next's tracer can't discover statically — so include it explicitly so
    // it ships in the serverless function. (Next 14: under `experimental`; Next 15
    // moves this to the top level.) Add any other route that rasterizes figures.
    outputFileTracingIncludes: {
      "/api/showcase/export": ["./assets/fonts/**"],
    },
  },
};

export default nextConfig;
