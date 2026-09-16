// Evergreen SEO refresh: glossary_terms + a handful of static pages
// (About, Disclosure, Privacy, Terms, the Learn hub index) only. Deliberately
// excludes published news/Analysis articles - those are timestamped and
// shouldn't have their metadata silently changed after the fact.
//
// For each item: if its current seo_title/seo_description score below
// SCORE_THRESHOLD, or it hasn't been reviewed in REVIEW_INTERVAL_DAYS,
// regenerate ONLY those two fields via the AI provider, using the item's
// existing body text as input. The body itself is never touched. Every
// item's seo_last_reviewed_at is updated when checked, whether or not its
// metadata actually changed.
import { query } from "../../db.js";
import { scoreSeoFields } from "./seoScore.js";
import { generateSeoRefresh } from "../ai/provider.js";

const SCORE_THRESHOLD = 80;
const REVIEW_INTERVAL_DAYS = 30;

function needsRefresh(seoTitle, seoDescription, lastReviewedAt) {
  if (scoreSeoFields(seoTitle, seoDescription) < SCORE_THRESHOLD) return true;
  if (!lastReviewedAt) return true;
  const daysSince = (Date.now() - new Date(lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= REVIEW_INTERVAL_DAYS;
}

async function refreshGlossary() {
  const { rows } = await query(
    "SELECT id, term, body, seo_title, seo_description, seo_last_reviewed_at FROM glossary_terms"
  );

  let reviewed = 0;
  let regenerated = 0;

  for (const term of rows) {
    reviewed += 1;
    if (!needsRefresh(term.seo_title, term.seo_description, term.seo_last_reviewed_at)) continue;

    const draft = await generateSeoRefresh({ label: term.term, body: term.body });

    // A mock-provider result is placeholder text - never let it overwrite
    // real production SEO fields (same principle as the news pipeline's
    // publish guard). Still mark it reviewed so it isn't re-checked every
    // run while AI_PROVIDER is unset/mis-cased.
    if (draft.provider === "mock") {
      console.log(`Evergreen SEO: skipping apply for glossary term "${term.term}" - mock provider.`);
      await query("UPDATE glossary_terms SET seo_last_reviewed_at = now() WHERE id = $1", [term.id]);
      continue;
    }

    await query(
      "UPDATE glossary_terms SET seo_title = $1, seo_description = $2, seo_last_reviewed_at = now() WHERE id = $3",
      [draft.seo_title, draft.seo_description, term.id]
    );
    regenerated += 1;
  }

  return { reviewed, regenerated };
}

async function refreshStaticPages() {
  const { rows } = await query(
    "SELECT path, seo_title, seo_description, body_text, seo_last_reviewed_at FROM page_seo"
  );

  let reviewed = 0;
  let regenerated = 0;

  for (const page of rows) {
    reviewed += 1;
    if (!needsRefresh(page.seo_title, page.seo_description, page.seo_last_reviewed_at)) continue;

    const draft = await generateSeoRefresh({ label: page.path, body: page.body_text });

    if (draft.provider === "mock") {
      console.log(`Evergreen SEO: skipping apply for page "${page.path}" - mock provider.`);
      await query("UPDATE page_seo SET seo_last_reviewed_at = now() WHERE path = $1", [page.path]);
      continue;
    }

    await query(
      "UPDATE page_seo SET seo_title = $1, seo_description = $2, seo_last_reviewed_at = now() WHERE path = $3",
      [draft.seo_title, draft.seo_description, page.path]
    );
    regenerated += 1;
  }

  return { reviewed, regenerated };
}

export async function runEvergreenSeoRefresh() {
  const glossary = await refreshGlossary();
  const pages = await refreshStaticPages();

  return {
    reviewed: glossary.reviewed + pages.reviewed,
    regenerated: glossary.regenerated + pages.regenerated,
    glossary,
    pages,
  };
}
