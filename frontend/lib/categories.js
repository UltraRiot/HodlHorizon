// Single source of truth for the category pill nav and for validating a
// /category/[slug] route param - shared by pages/index.js ("All") and
// pages/category/[slug].js (everything else) so the two pill lists can
// never drift apart.
const ALL_CATEGORIES = [
  { slug: "all", name: "All" },
  { slug: "stocks", name: "Stocks" },
  { slug: "indices", name: "Indices" },
  { slug: "commodities", name: "Commodities" },
  { slug: "crypto", name: "Crypto" },
  { slug: "analysis", name: "Analysis" },
];

// News-is-the-only-active-category priority shift: Analysis is hidden from
// nav/homepage but deliberately NOT deleted anywhere (code, tests, DB
// tables, existing published articles/permalinks all stay intact) so it
// can be fully re-enabled later by removing a slug from this one array.
// Every consumer of CATEGORIES (pills, /category/[slug] static paths)
// already reads this exported constant, so hiding it here is enough for
// all of them at once.
const HIDDEN_CATEGORY_SLUGS = ["analysis"];

export const CATEGORIES = ALL_CATEGORIES.filter((c) => !HIDDEN_CATEGORY_SLUGS.includes(c.slug));
