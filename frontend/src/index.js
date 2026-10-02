import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

// Register the app-shell service worker (offline open). It is network-first for the
// page, so a new deploy shows up on the very next load — and open tabs switch over
// to the new version on their own (check on focus + every 5 minutes).
// Offline data/mutation handling lives in src/lib/api.js + src/lib/offline.js.
if ("serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;   // first-ever install: nothing old to replace
    reloading = true;
    window.location.reload();                  // a newer version took over -> show it now
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" })
      .then((reg) => {
        const check = () => reg.update().catch(() => { /* offline — try later */ });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
        setInterval(check, 5 * 60 * 1000);
      })
      .catch(() => { /* not fatal — app still works online */ });
  });
}
