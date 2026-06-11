// Created and developed by Jai Singh
import React from "react";
import ReactDOM from "react-dom/client";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "sonner";

import { App } from "./App";
import "./index.css";

/**
 * TanStack Query client tuned for an always-connected desktop shell:
 *
 * - Retries on read failures are aggressive in production (3 attempts with
 *   exponential backoff) so a transient agent restart heals without a
 *   manual refresh.
 * - The mutation cache shows a single toast on uncaught errors — the
 *   `sessionActions` helpers wrap their own toasts so this only fires for
 *   ad-hoc `useMutation` callsites the components might add later.
 * - `refetchOnWindowFocus` is off because the per-query hooks set their
 *   own intervals + listen to Tauri events.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(8_000, 600 * Math.pow(2, attempt)),
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    // Silently swallow; per-component hooks log via the toast helpers.
  }),
  mutationCache: new MutationCache(),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast:
              "border-border bg-card text-foreground shadow-elev-2 rounded-lg",
            title: "text-[12.5px] font-medium",
            description: "text-[11px] text-muted-foreground",
          },
        }}
        theme="system"
        richColors
        closeButton
      />
    </QueryClientProvider>
  </React.StrictMode>,
);

// Created and developed by Jai Singh
