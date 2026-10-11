/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "query", key: "category", value: "(?<category>.*)" }],
        destination: "/category/:category",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
