const ALL_CATEGORIES = [
  { slug: "all", name: "All" },
  { slug: "stocks", name: "Stocks" },
  { slug: "indices", name: "Indices" },
  { slug: "commodities", name: "Commodities" },
  { slug: "crypto", name: "Crypto" },
  { slug: "analysis", name: "Analysis" },
];

const HIDDEN_CATEGORY_SLUGS = ["analysis"];

export const CATEGORIES = ALL_CATEGORIES.filter((c) => !HIDDEN_CATEGORY_SLUGS.includes(c.slug));
