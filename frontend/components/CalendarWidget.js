import { forecastPreviousText } from "../lib/calendarFormat";

// Colors come from globals.css's --impact-* tokens (kept separate from
// --red/--gold/--text-mute so this mapping can't silently drift if those
// brand/status tokens are ever retuned - see the comment there). Any
// impact value that isn't exactly "high"/"medium"/"low" (shouldn't happen -
// the backend already normalizes this, see services/calendar/
// syncForexFactory.js's mapImpact() - but never trust that blindly from a
// frontend component) falls back to the low tier rather than rendering an
// unstyled, invisible dot/badge.
const IMPACT_COLOR = {
  high: "var(--impact-high)",
  medium: "var(--impact-medium)",
  low: "var(--impact-low)",
};

function impactColor(impact) {
  return IMPACT_COLOR[impact] || IMPACT_COLOR.low;
}

const IMPACT_LABEL = { high: "HIGH", medium: "MED", low: "LOW" };

function impactLabel(impact) {
  return IMPACT_LABEL[impact] || IMPACT_LABEL.low;
}

const LEGEND = [
  { impact: "high", label: "High" },
  { impact: "medium", label: "Medium" },
  { impact: "low", label: "Low" },
];

// Today's calendar (GET /api/calendar/today) - every impact level, since
// a single day can genuinely mix all three. Unlike widgets that vanish
// when empty (PollWidget, MoversWidget), this one always renders its
// card - a quiet day with nothing scheduled is real information for a
// visitor, not something to hide (see UpcomingCalendarWidget.js for the
// "Upcoming This Week" companion, high-impact only).
export default function CalendarWidget({ events }) {
  const list = events || [];

  return (
    <div className="card">
      <h3 className="serif" style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}>
        Today's Calendar
      </h3>

      {/* A colored dot with no key is decoration, not information, to a
          first-time visitor - one compact row, not its own section, so
          it doesn't push the card noticeably taller next to the other
          sidebar widgets. */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        {LEGEND.map((item) => (
          <div key={item.impact} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: impactColor(item.impact), flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--text-mute)" }}>{item.label}</span>
          </div>
        ))}
      </div>

      {list.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-mute)", fontSize: 13 }}>No major events today.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {list.slice(0, 5).map((event) => {
            const forecastPrevious = forecastPreviousText(event);
            return (
              <div key={event.id} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: impactColor(event.impact), marginTop: 6, flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>{event.title}</div>

                  {/* Date + region + impact badge all on one line, e.g.
                      "Sep 16 · US · HIGH" - region is skipped for manual
                      admin-entered events (region is always null for
                      those, see migrations/012_calendar_forexfactory.sql)
                      rather than showing an empty tag. Region and impact
                      are the same visual weight (10px/700/0.6 letter-
                      spacing) so region reads as a peer to impact, not a
                      louder or quieter signal. */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-mute)", flexWrap: "wrap" }}>
                    <span>{new Date(event.event_time).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    {event.region && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>
                          {event.region}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: impactColor(event.impact) }}>
                      {impactLabel(event.impact)}
                    </span>
                  </div>

                  {/* Only rendered when the feed actually gave us a
                      forecast or a previous value. */}
                  {forecastPrevious && (
                    <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 2 }}>{forecastPrevious}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
