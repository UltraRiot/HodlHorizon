import Link from "next/link";
import Seo from "../../components/Seo";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import Ticker from "../../components/Ticker";
import MarketsOverview from "../../components/MarketsOverview";
import ArticleCard from "../../components/ArticleCard";
import PollWidget from "../../components/PollWidget";
import MostReadWidget from "../../components/MostReadWidget";
import CalendarWidget from "../../components/CalendarWidget";
import UpcomingCalendarWidget from "../../components/UpcomingCalendarWidget";
import { apiGet } from "../../lib/api";
import { CATEGORIES } from "../../lib/categories";

// Safe wrapper: if one backend call fails (e.g. a market data provider is
// down), the rest of the page still renders instead of a 500 page. Same
// helper as pages/index.js's - duplicated rather than imported across a
// page boundary for three lines.
async function safe(promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    console.error(err.message);
    return fallback;
  }
}

// One page per real category, known upfront from the shared CATEGORIES
// list - "all" excluded, it lives at "/" (pages/index.js), not here.
// fallback: false (not "blocking") because that list is the complete,
// closed set of valid slugs: anything else is a genuine 404, not a
// not-yet-generated page, so there's nothing useful a blocking fallback
// would ever generate on demand.
export async function getStaticPaths() {
  return {
    paths: CATEGORIES.filter((c) => c.slug !== "all").map((c) => ({ params: { slug: c.slug } })),
    fallback: false,
  };
}

// ISR, not SSR - see pages/index.js's getStaticProps comment for why
// (nothing here is per-visitor either, so the same 60s-revalidated build
// serves every visitor of a given category).
export async function getStaticProps({ params }) {
  // "all" isn't a real category route - it lives at "/" - so it's
  // explicitly excluded here even though it's in the shared CATEGORIES
  // list. Anything else not in the list 404s instead of silently
  // rendering an empty page for a typo'd slug. (getStaticPaths above
  // already guarantees this for every real deploy, since fallback:false
  // means Next never even calls this function for an unlisted slug - this
  // check stays as a second guard rather than an assumption, since
  // params.slug still technically could reach here some other way.)
  const category = CATEGORIES.find((c) => c.slug === params.slug && c.slug !== "all");
  if (!category) {
    return { notFound: true };
  }

  const [articles, ticker, poll, overview, calendarToday, calendarUpcoming, mostRead] = await Promise.all([
    safe(apiGet(`/api/articles?category=${category.slug}&limit=20`), []),
    safe(apiGet("/api/market/ticker"), { crypto: [], stocks: [] }),
    safe(apiGet("/api/polls/latest"), null),
    safe(apiGet("/api/market/overview"), { indices: [], forex: [], commodities: [], stocks: [], crypto: [], last_updated: null }),
    safe(apiGet("/api/calendar/today"), []),
    safe(apiGet("/api/calendar/upcoming"), []),
    safe(apiGet("/api/articles/most-read"), []),
  ]);

  return {
    props: {
      articles,
      ticker,
      poll,
      overview,
      calendarToday,
      calendarUpcoming,
      mostRead,
      category: category.slug,
      categoryName: category.name,
    },
    revalidate: 60,
  };
}

export default function CategoryPage({
  articles,
  ticker,
  poll,
  overview,
  calendarToday,
  calendarUpcoming,
  mostRead,
  category,
  categoryName,
}) {
  return (
    <>
      <Seo
        title={`${categoryName} News — Hodl Horizon`}
        description={`Short, AI-summarized ${categoryName.toLowerCase()} coverage — read the whole story in seconds.`}
        path={`/category/${category}`}
      />

      <Header />
      <Ticker crypto={ticker.crypto} stocks={ticker.stocks} />
      <MarketsOverview overview={overview} />

      <main className="container home-layout" style={{ padding: "40px 48px 90px", display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 48 }}>
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22, flexWrap: "wrap", gap: 14 }}>
            <h1 className="serif" style={{ fontSize: 14, textTransform: "uppercase", letterSpacing: 1.6, color: "var(--text-mute)", fontWeight: 600, margin: 0 }}>
              Latest News
            </h1>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.slug}
                  href={c.slug === "all" ? "/" : `/category/${c.slug}`}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: category === c.slug ? 600 : 500,
                    border: "1px solid var(--border)",
                    color: category === c.slug ? "#1a1508" : "var(--text-dim)",
                    background: category === c.slug ? "var(--gold-fill)" : "transparent",
                    borderColor: category === c.slug ? "var(--gold-fill)" : "var(--border)",
                  }}
                >
                  {c.name}
                </Link>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--border)" }}>
            {articles.length === 0 && (
              <p style={{ color: "var(--text-mute)", padding: "24px 2px" }}>
                No {categoryName.toLowerCase()} articles yet.
              </p>
            )}
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <MostReadWidget articles={mostRead} />
          <CalendarWidget events={calendarToday} />
          <UpcomingCalendarWidget events={calendarUpcoming} />
          <PollWidget poll={poll} />
          <div className="card" style={{ borderStyle: "dashed", textAlign: "center", color: "var(--text-mute)", fontSize: 12.5, padding: "34px 20px" }}>
            Ad Space
          </div>
        </aside>
      </main>

      <Footer />
    </>
  );
}
