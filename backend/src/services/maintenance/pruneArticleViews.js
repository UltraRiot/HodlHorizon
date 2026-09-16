// article_views (migrations/004_article_views.sql) is a one-row-per-page-load
// event log with no dedup, kept only to power the "Most Read Today" widget's
// rolling recent-views window - nothing reads a row once it's more than a
// day or two old. Left unpruned it grows forever (pre-launch audit flagged
// this as the one table that will actually matter at real traffic, unlike
// the site's other growing tables). 48h, not 24h, so the window has a
// margin over whatever the widget actually queries - deleting right at the
// edge of what's still being read would be fragile.
import { query } from "../../db.js";

export async function pruneArticleViews() {
  const { rowCount } = await query("DELETE FROM article_views WHERE viewed_at < now() - interval '48 hours'");
  return { deleted: rowCount };
}
