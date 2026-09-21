# Freshness & Breaking-News Pipeline Review - 2026-09-20

Live review of the OpenAI (`AI_PROVIDER=openai`, `gpt-4o-mini`) article-generation pipeline, focused specifically on whether the site publishes what's happening now, while it's still fresh. Run at 2026-09-20T11:25-11:43 UTC (a Sunday).

## Pre-flight: confirming this is genuinely live

- **`AI_PROVIDER=openai`** and a real `OPENAI_API_KEY` (165 chars) are set in `backend/.env`. `OPENAI_MODEL=gpt-4o-mini`.
- **`ai_usage_log` shows real, non-flat numbers.** The most recent real generation burst (23 rows, 2026-09-19T22:00:02-22:01:09Z) logged `article` calls ranging 3,230-3,457 tokens ($0.0006 each), `redundancy_check` calls 1,017-1,158 tokens ($0.0002 each), and `seo_refresh` calls 311-433 tokens ($0.0001 each) - naturally varying per-call, consistent with real gpt-4o-mini usage, not a flat mock number.
- **RSS fetch mechanism is live**, not cached: `fetchSources.js` calls `parser.parseURL(source.rss_url)` per source, per scan, with no caching layer - confirmed by reading the code. (Whether it actually *ran* this cycle is a finding in itself - see below.)

## Headline finding: the pipeline is not "too slow" - for most of every day, it is off

Triggering a real scan just now (`runScanAndGenerate()`, the exact function `POST /scan-now` calls) produced **zero output**:

```
AI engine: stocks paced - checkpoint ceiling 0/1 reached for this hour (1 used today).
AI engine: indices paced - checkpoint ceiling 0/1 reached for this hour (1 used today).
AI engine: commodities paced - checkpoint ceiling 0/1 reached for this hour (1 used today).
AI engine: crypto paced - checkpoint ceiling 2/6 reached for this hour (5 used today).
{ itemsScanned: 0, newStories: 0, published: 0, sentToReview: 0, ... }
```

Every category was blocked by the quota/pacing gate **before the code ever reached the RSS-fetch step** - `itemsScanned: 0` means no live feed was even hit this cycle. `ai_usage_log` and `articles` row counts were byte-identical before and after (2080/2080, 888/888). This was independently reproduced ~14 minutes later by the real, already-running production scheduler's own organic 15-minute tick (`News engine: starting scheduled scan...` -> same four "paced" lines -> `itemsScanned: 0`) - not something I engineered.

**Root cause, confirmed by reading the code and the database configuration, not assumed:**

1. `currentPacingCeiling()` (`scanAndGenerate.js`) computes its checkpoint using `now.getUTCHours()` - true UTC.
2. `articlesCreatedToday()` (`articleUtils.js`) resets its daily counter using `date_trunc('day', now())` in Postgres.
3. This Postgres instance's session timezone is **`Europe/Berlin`** (confirmed via `SHOW timezone`), not UTC. In September (CEST, UTC+2), `date_trunc('day', now())` truncates to **22:00 UTC the previous day** - not UTC midnight as the code's own comment claims ("`articlesCreatedToday()` resets at UTC midnight, so the cycle restarts fresh each day").
4. 22:00 UTC falls inside the pacing algorithm's **last** checkpoint bracket (`hour >= 21 -> 90% of the daily cap`). So the instant the daily counter resets, the ceiling is already at ~90% of the full day's quota for every category - there is no gradual ramp. Real data confirms this exactly: 8 articles (IDs 881-888 - 1 each for stocks/indices/commodities, 5 for crypto) were generated in a single **62-second burst from 22:00:07 to 22:01:09 UTC on 2026-09-19**, immediately after the reset.
5. Once that burst consumes the (near-)full daily allotment, the ceiling never rises high enough to free more room for the rest of the real calendar day, because the UTC-hour clock has already moved on to the *next* day's hours (0-20) by the time the *next* Berlin-midnight reset would arrive - the two clocks are permanently ~2 hours out of phase. Weekend-throttled categories (cap 1) get exactly **one** slot a day, burned in that first minute, then dark for ~23 hours regardless of any real news. Crypto (cap 6) burns 5 of 6 in the same minute and can structurally never reach the 6th (`round(6 × 0.9) = 5`, never 6) - so crypto, too, goes fully dark for the rest of the day once that happens.
6. This is not weekend-specific and not a one-off: it is inherent to the UTC-vs-Berlin mismatch and will recur every single day. The weekend caps (1/1/1) just make today's blackout total instead of merely severe.

**This is, by a wide margin, the dominant answer to "why isn't breaking news landing fresh today."** A market-moving story breaking at 14:00 UTC on this exact Sunday found every category already exhausted for the next ~10 hours, no matter how significant. The 72h freshness window and the 5h single-source delay (both examined below) are real, secondary frictions on top of this - but neither matters if the category is quota-dead for 23 of 24 hours regardless.

## Today's actual batch (the 22:00 UTC burst, 2026-09-19 - the only real batch available, since my own trigger and the live scheduler's tick both returned nothing)

| ID | Category | Status | Flags | Source pubDate (real, verified) | Age at generation | Title |
|---|---|---|---|---|---|---|
| 881 | Stocks | review | category, stale/thin, banned-word, stale-date (see note) | Yahoo Finance, 2026-09-19 ~02:59 UTC | ~19h | Jack Daniel's-Linked Whiskey Brand Files for Chapter 7 Bankruptcy |
| 882 | Indices | review | category, stale/thin | Yahoo Finance (Nasdaq/Verafin story, ~Sept 15-17) | ~2-4 days | Nasdaq Implements New Measures Against Crypto Crime |
| 883 | Commodities | review | category, filler | OilPrice.com, 2026-09-19 (same day) | <22h | UK Needs £150 Billion for Electricity Grid Overhaul |
| 884 | Crypto | review | verification-only | CoinDesk, 2026-09-18 ("1 day ago") | ~30h | U.S. Agencies Race to Replace Clarity Act Regulations |
| 885 | Crypto | review | verification-only | CoinDesk, 2026-09-17 (URL-dated; page widget showed "21h ago" at check time - see note) | ~56h (or less, see note) | Crypto Pioneer Marc van der Chijs Sells Bitcoin for AI Investment |
| 886 | Crypto | review | filler (uncorrected on retry - see note) | CoinDesk, 2026-09-19 ~14:30 UTC | ~7.5h | Ripple Prepares for XRP Ledger Payments Upgrade |
| 887 | Crypto | review | category | CoinTelegraph, 2026-09-19 (Friday launch day) | <22h | REX Launches 2x Leveraged ETF Tied to Bitcoin Firm Strive |
| 888 | Crypto | review | category | CoinTelegraph, 2026-09-19 (filed "Friday") | <22h | Kalshi Files for US Stock Perpetual Futures |

**All 8 landed in `review`. Zero published, zero scheduled.** All are single-source. `ai_usage_log` shows **16 `article` calls for these 8 articles - exactly 2 each** - meaning every single one of them failed verification on its first draft and needed a retry, a 100% first-draft-failure rate in this real batch (a quality data point, not a freshness one - the retries cost seconds, not hours).

Freshness verdict on sourcing: every source here was well within the 72h window, and most (5 of 8) were same-day or under 24h old at pickup - the *sourcing* side of freshness is working fine today. The problem is entirely downstream: none of these 8 could reach a reader today regardless, because review is a human queue with no SLA, and the categories that produced them are now quota-dead for the rest of the day.

## Reading the bodies against their real sources

**[881] Jack Daniel's-Linked Whiskey Brand - confirmed fabrication, caught (partly by luck).** Live-fetched the real Yahoo Finance source: it is about **Humble Baron**, a *bar* (not a whiskey brand) operated by Keith Weaver at the Uncle Nearest distillery, which filed Chapter 11 in June 2026 and was converted to Chapter 7 on Sept 14, 2026. The source **never mentions a "second" filing or an earlier 2020 bankruptcy at all** - the generated body invented both the "second filing" framing and the entire "first Chapter 7 filing in 2020" fact, on top of mischaracterizing a bar as "the whiskey brand tied to Jack Daniel's." This is a real, wholesale invented-fact hallucination, not a vague-language issue. It was correctly caught and routed to review, but by three separate mechanisms doing double duty rather than one designed for it: `stale_content` (the thin-source check, correctly triggered because Yahoo Finance supplied no real body content), `category_mismatch`, and - interestingly - `findStaleForwardLookingDate`, which *did* fire on this real output, but for the wrong reason: it matched "2020" (the fabricated year) sharing a sentence with an unrelated, genuinely-forward-looking "will affect its operations," not because it understood the 2020 claim itself was invented. Right result, coincidental mechanism - worth knowing this check can fire on a correctly-flagged article for an unrelated reason. `findBannedWordViolation` also correctly caught "moving forward" in the same body.

**[886] Ripple XRP Ledger - the freshest, cleanest story in the batch, still stuck in review.** Real CoinDesk source published ~14:30 UTC same day; picked up and generated ~7.5 hours later - a genuinely good freshness result. Present-tense/forward-tense framing is accurate (activation is genuinely still pending, no stale year anywhere) - `findStaleForwardLookingDate` and `findStaleRoleAssertion` correctly found nothing wrong, and there is none. But `findGenericSignificanceFiller` correctly flags "The upgrade is significant for developers and businesses..." as filler - and **that filler phrase is still in the saved, live body**, meaning the mechanical clause-stripping fix (`stripGenericSignificanceFillerClauses`) did not visibly apply here. I tested the fix in isolation against this exact real sentence and it works correctly (drops the filler paragraph cleanly). The likely explanation: this batch was generated by an already-running server process that loaded `provider.js` into memory before the fix was added to the file on disk - Node doesn't hot-reload, so a stale long-running process would keep using the pre-fix code even though the file is current. Worth confirming the production process has actually been restarted since that change landed.

**[885] Marc van der Chijs - accurate content, ambiguous real age.** Real CoinDesk quotes match closely ("I sold a lot of my bitcoin. I went into AI" / reinvesting AI profits back into crypto via ETFs) - no fabrication found. The URL is dated 2026-09-17, but the live page's own "time since publish" widget read "21 hours ago" relative to my check just now (~2026-09-20T11:30) - which would place it closer to 2026-09-19 ~14:30, not the 17th. I can't fully resolve this discrepancy (URL slug date vs. a possibly-updated "last modified" widget), so I'm reporting both rather than asserting false precision. Either way, this is the batch's clearest illustration of the 72h window's looseness in practice: even at the *older* reading (~56h), a human-interest/opinion piece that's no longer remotely "breaking" by any definition sailed through the freshness gate exactly as an hour-old story would have.

**[887] REX ASSX ETF - real, no fabrication, but a real fact was left on the table.** Body's claim ("Strive has not yet released performance metrics...") is accurate - the source doesn't give ETF performance data either. But the source **does** state a concrete, checkable fact the draft omitted entirely: "Strive shares rose 6.4% on Friday to close at $30.09." A vaguer version of `findGenericSignificanceFiller`'s failure mode (a nearby-but-not-quite phrase, "could influence trading strategies," doesn't match `findVagueCrossAssetClaim`'s current phrase list either) - not a bug, just a real near-miss worth knowing about for future tuning.

**[882], [883], [884], [888]:** read cleanly against source material for tense/role/date correctness - no stale-role, stale-date, or vague-ripple-effect language found or missed. `findStaleRoleAssertion` and `findVagueCrossAssetClaim` found nothing in this entire 8-article batch (there was no office-holder or cross-asset-impact content to trigger them either way - a clean negative, not evidence either way about their real-world hit rate).

## The 5-hour single-source delay: does it bite in practice?

None of today's 8 articles reached "scheduled" (all were flagged, so none were eligible). To answer the question with real evidence, I pulled every article from the last real production cycle that *did* go through the scheduled/delayed path (2026-09-19).

Two clusters emerged. One set published only 2-7 minutes after creation despite having a 5-hours-out `auto_publish_at` already stamped - almost certainly a human manually publishing early via the admin panel during that session (the DB shows no code path that publishes a "scheduled" row early other than a manual status edit, and this repo's own history shows active, hands-on batch-testing sessions around that time). That cluster tells us nothing about the delay's real bite and I'm not counting it as evidence either way.

The other set rode out the **full, real 5-hour wait**, confirmed by `auto_publish_at <= now()` genuinely elapsing in wall-clock time before `publishDueScheduledArticles()` (the scheduler's own once-per-15-minutes flip) picked them up:

| ID | Title | Created | Auto-published | Real delay |
|---|---|---|---|---|
| 497 | SEC Proposes Regulated Pathway for Tokenized Stocks | 11:01:54 | 16:15:02 | 5h13m |
| 530 | Japan's Refiners Secure Crude Supply Through November | 11:08:14 | 16:15:02 | 5h07m |
| 533 | Canada's Gold Projects Face $11B in Permitting Delays | 11:08:40 | 16:15:02 | 5h06m |
| 557 | Ethereum Institutional Signals Support for Reduced Block Times | 11:11:06 | 16:15:02 | 5h04m |
| 610 | Almonty to Supply Sandvik with Tungsten from Spanish Tailings | 11:31:47 | 16:45:01 | 5h13m |
| 618 | Lundin Gold Faces $154M Tax Dispute in Ecuador | 11:32:13 | 16:45:01 | 5h13m |
| 638 | North Korea and Iran Drive Onchain Malware Surge | 11:33:05 | 16:45:01 | 5h12m |
| 672 | SEC Approves Innovation Exemption for Tokenized Stocks | 11:34:45 | 16:45:01 | 5h10m |

**This is a real, concrete bite, not a hypothetical.** [497]/[672] are two stages of the same real, genuinely time-sensitive SEC regulatory story (a proposed, then approved, tokenized-stock exemption) - each individually verified clean by the pipeline within minutes of generation, and each individually made to wait 5+ hours anyway before a reader could see it. [638] (North Korea/Iran malware) is a security story where 5 hours of staleness plausibly matters more than most. None of these needed the wait on quality grounds - they were already `verificationClean: true` with zero flags the moment they were generated; the delay is pure elapsed-time, added after the content was already judged safe to publish unattended.

## Verdict

**"Breaking news, published while fresh" is not happening today**, and the primary reason is not sourcing, not the model, and not (on its own) the 5-hour delay - it's the **pacing/quota reset-clock bug**: because the daily-article counter resets at Berlin midnight (22:00 UTC) while the pacing algorithm's checkpoints are keyed to true UTC hours, every category dumps its entire day's quota in a ~60-second burst right after reset and then goes fully or almost-fully dark for the remaining ~23 hours, independent of what's actually breaking. This is confirmed live, right now, by both a manual trigger and the real production scheduler's own organic tick, both returning zero output. It will recur every day until the reset boundary and the pacing clock agree on a timezone.

Ranked by real impact, from this investigation:
1. **The pacing/reset timezone bug (new finding, not in scope of the original three priorities)** - full-day blackout, confirmed live, happening right now. Fix candidate: make `articlesCreatedToday()`'s day boundary UTC-explicit (`date_trunc('day', now() AT TIME ZONE 'UTC')` or equivalent), so it agrees with `currentPacingCeiling()`'s clock.
2. **The 5-hour single-source auto-publish delay** - real, evidenced bite (497/672/638 above): a verified-clean, zero-flag story still sits for 5+ hours before anyone can read it. This is a known, deliberate tradeoff (the task said not to change it) but the real cost is now measured, not guessed: every single-source clean story, every day, loses at least 5 hours it didn't need to on quality grounds.
3. **The 72h freshness window** - looser than ideal (the 885 case shows a ~2-day-old opinion piece treated identically to an hour-old one) but secondary to the above two; it did not produce any article that was actually stale-feeling in tone (881's fabrication was a hallucination problem, not a staleness-of-source problem).
4. **The model itself** - mixed. Deterministic guardrails caught real problems live (881's fabrication, 883/886's filler), and no stale-role or vague-cross-asset language was found or missed in this batch. The one real gap: 886 shows the filler-clause mechanical fix not visibly active in the running process that generated it (likely a stale in-memory module, not a defect in the fix) - worth confirming after a restart. The 100% first-draft-retry rate in this batch (8/8) is a real quality signal worth watching, though it costs seconds, not hours.

Scan frequency (15 minutes) was not a bottleneck in anything observed today - the pipeline never got the chance to be limited by it, because the quota gate closed the door first.
