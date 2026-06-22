"use client";

import { useEffect } from "react";

// Dispara um prefetch do Radar em background quando o usuário entra no site.
// Aquece o cache ICS antes de o usuário acessar /radar — sem bloquear nada.
// Usa sessionStorage para rodar apenas uma vez por sessão de navegador.
//
// Estratégia de timing:
//   1. Aguarda 6 s após o mount (hydration + recursos críticos terminaram)
//   2. Dentro desse delay, usa requestIdleCallback quando disponível —
//      só executa quando o browser está ocioso, sem concorrer com LCP/FID.
const SESSION_KEY = "poplog_radar_prefetch_done";

export default function RadarBackgroundPrefetch() {
  useEffect(() => {
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_KEY)
    ) {
      return;
    }

    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function doFetch() {
      fetch("/api/radar?mode=general", {
        method: "GET",
        keepalive: true,
      })
        .then((res) => {
          if (res.ok) {
            if (process.env.NODE_ENV === "development") {
              console.log("[RadarPrefetch] cache aquecido com sucesso");
            }
          }
        })
        .catch(() => {
          // Silencioso — prefetch é best-effort
        })
        .finally(() => {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(SESSION_KEY, "1");
          }
        });
    }

    // Aguarda 6 s para garantir que LCP, hidratação e fetch críticos já terminaram
    timerId = setTimeout(() => {
      if (typeof requestIdleCallback !== "undefined") {
        // Executa somente quando o browser estiver ocioso (timeout de 10 s como fallback)
        idleId = requestIdleCallback(doFetch, { timeout: 10_000 });
      } else {
        doFetch();
      }
    }, 6_000);

    return () => {
      if (timerId !== null) clearTimeout(timerId);
      if (idleId !== null && typeof cancelIdleCallback !== "undefined") {
        cancelIdleCallback(idleId);
      }
    };
  }, []);

  return null;
}
