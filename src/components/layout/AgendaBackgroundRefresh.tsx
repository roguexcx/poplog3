"use client";
import { useEffect } from "react";

// Fires once per browser session to keep the agenda cache warm.
// If the cache is older than the threshold (6h), a background rebuild is triggered
// server-side — the client never waits for it.
const SESSION_KEY = "poplog_agenda_refresh_done";

export default function AgendaBackgroundRefresh() {
  useEffect(() => {
    // Only run once per session
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(SESSION_KEY)) {
      return;
    }

    fetch("/api/ics/agenda/background-refresh", {
      method: "GET",
      // keepalive lets the request outlive the page if needed
      keepalive: true,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.triggered) {
          console.log("[AgendaRefresh] background refresh triggered (cache age:", data.ageHours, "h)");
        }
      })
      .catch(() => {
        // Silently ignore — this is best-effort
      })
      .finally(() => {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(SESSION_KEY, "1");
        }
      });
  }, []);

  // Renders nothing
  return null;
}
