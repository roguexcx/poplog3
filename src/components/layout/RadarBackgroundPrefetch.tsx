"use client";

import { useEffect } from "react";

// Dispara um prefetch do Radar em background quando o usuário entra no site.
// Aquece o cache ICS antes de o usuário acessar /radar — sem bloquear nada.
// Usa sessionStorage para rodar apenas uma vez por sessão de navegador.
const SESSION_KEY = "poplog_radar_prefetch_done";

export default function RadarBackgroundPrefetch() {
  useEffect(() => {
    // Só roda uma vez por sessão
    if (
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(SESSION_KEY)
    ) {
      return;
    }

    // Delay curto para não competir com o carregamento crítico da página inicial
    const timer = setTimeout(() => {
      fetch("/api/radar?mode=general", {
        method: "GET",
        // keepalive permite que o request sobreviva a navegações
        keepalive: true,
      })
        .then((res) => {
          if (res.ok) {
            console.log("[RadarPrefetch] cache aquecido com sucesso");
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
    }, 3000); // aguarda 3s após o mount para não disputar com recursos críticos

    return () => clearTimeout(timer);
  }, []);

  // Não renderiza nada
  return null;
}
