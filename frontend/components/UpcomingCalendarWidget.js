import { forecastPreviousText } from "../lib/calendarFormat";

export default function UpcomingCalendarWidget({ events }) {
  const list = events || [];

  return (
    <div className="card">
      <h3 className="serif" style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}>
        Upcoming This Week
      </h3>

      {list.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-mute)", fontSize: 13 }}>No high-impact events remaining this week.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {list.slice(0, 5).map((event) => {
            const forecastPrevious = forecastPreviousText(event);
            return (
              <div key={event.id}>
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
                </div>

                {forecastPrevious && (
                  <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 2 }}>{forecastPrevious}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
