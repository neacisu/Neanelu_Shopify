import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Datele sunt considerate "fresh" timp de 1 minute.
      // Nu se va face refetch automat dacă datele au fost luate acum < 1 min.
      staleTime: 60 * 1000,

      // Garbage collection time. Datele inactive rămân în cache 5 minute.
      gcTime: 5 * 60 * 1000,

      // Dezactivăm refetch automat la focus fereastră global (opt-in per query dacă e necesar).
      refetchOnWindowFocus: false,

      // Retry o singură dată la eroare (în total 2 request-uri).
      retry: 1,

      // Nu facem retry la erori 404 (Not Found) sau 403/401 (Auth).
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      retry: 0,
    },
  },
});
