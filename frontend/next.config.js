/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Set false for smoother force-graph canvas rendering
  // The web client is hosted separately from the MCOS repo but sits inside its tree, so
  // ESLint resolved upward and applied the backend's type-aware config — whose tsconfig
  // includes no frontend file, failing every one of them. Types are still checked by tsc.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
