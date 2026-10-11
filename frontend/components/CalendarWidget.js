import { forecastPreviousText } from "../lib/calendarFormat";

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

export default function CalendarWidget({ events }) {
  const list = events || [];

  return (
    <div className="card">
      <h3 className="serif" style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}>
        Today's Calendar
      </h3>

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
