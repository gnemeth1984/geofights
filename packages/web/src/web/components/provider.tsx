import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GeoProvider } from "@/hooks/use-geo";
import { registerServiceWorker } from "@/lib/pwa";

const queryClient = new QueryClient();

interface ProviderProps {
  children: React.ReactNode;
}

// App-level providers — add theme/context providers here, wrapping children.
// QueryClientProvider must stay (all API calls run through TanStack Query).
export function Provider({ children }: ProviderProps) {
  // Installability: the worker is what makes the browser offer "install",
  // and it keeps a cold launch of the installed app working offline.
  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Location lives above the router: one watch, one consent record, and
          the only path to the geolocation API in the client. */}
      <GeoProvider>{children}</GeoProvider>
    </QueryClientProvider>
  );
}
