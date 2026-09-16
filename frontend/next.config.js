/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Old /?category=x URLs (already-indexed, or bookmarked/linked
  // elsewhere) 301 to the new /category/x route instead of just
  // rendering the homepage with no indication anything moved - see
  // pages/category/[slug].js.
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
