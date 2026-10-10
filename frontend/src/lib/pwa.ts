import { useEffect, useState } from "react";

let waitingWorker: ServiceWorker | null = null;
let reloadRequested = false;
const listeners = new Set<() => void>();

function announce(worker: ServiceWorker) {
  waitingWorker = worker;
  listeners.forEach((listener) => listener());
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js").then((registration) => {
    if (registration.waiting && navigator.serviceWorker.controller)
      announce(registration.waiting);
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        )
          announce(installing);
      });
    });
    setInterval(() => void registration.update(), 60 * 60_000);
  });
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // clients.claim() also emits controllerchange on the very first install. Reload only when the
    // user accepted a waiting update, otherwise initial page work (including checkout/login) can
    // be interrupted.
    if (!reloadRequested || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

export function usePwaUpdate() {
  const [ready, setReady] = useState(Boolean(waitingWorker));
  useEffect(() => {
    const listener = () => setReady(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return {
    ready,
    apply: () => {
      if (!waitingWorker) return;
      reloadRequested = true;
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    },
  };
}
