// Single source of truth for the category pill nav and for validating a
// /category/[slug] route param - shared by pages/index.js ("All") and
// pages/category/[slug].js (everything else) so the two pill lists can
// never drift apart.
export const CATEGORIES = [
  { slug: "all", name: "All" },
  { slug: "stocks", name: "Stocks" },
  { slug: "indices", name: "Indices" },
  { slug: "commodities", name: "Commodities" },
  { slug: "crypto", name: "Crypto" },
  { slug: "analysis", name: "Analysis" },
];
