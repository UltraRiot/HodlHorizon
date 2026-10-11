import { query } from "../../db.js";

export async function pruneArticleViews() {
  const { rowCount } = await query("DELETE FROM article_views WHERE viewed_at < now() - interval '48 hours'");
  return { deleted: rowCount };
}
