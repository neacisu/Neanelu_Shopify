import type { useFetcher } from 'react-router-dom';

/**
 * Hook care oferă valori optimiste în timpul unei acțiuni React Router de tip Fetcher.
 *
 * Extrage valorile din `fetcher.formData` dacă există o acțiune în desfășurare.
 * Altfel returnează valoarea curentă (server state).
 *
 * @param currentValue - Valoarea curentă confirmată de server (din loader/props).
 * @param fieldName - Numele câmpului din formData care conține noua valoare.
 * @param fetcher - Instanța useFetcher care execută acțiunea.
 * @param transformer - (Opțional) Transformare din string (FormData) în tipul T.
 *
 * @returns Valoarea optimistă sau valoarea curentă.
 */
export function useOptimisticAction<T>(
  currentValue: T,
  fieldName: string,
  fetcher: ReturnType<typeof useFetcher>,
  transformer: (val: string) => T = (val) => val as unknown as T
): T {
  // Dacă fetcherul trimite date și nu e "idle", încercăm să extragem valoarea optimistă
  if (fetcher.state !== 'idle' && fetcher.formData) {
    const hopefulValue = fetcher.formData.get(fieldName);

    // Dacă am găsit valoarea în payload-ul trimis, o folosim
    if (hopefulValue !== null && typeof hopefulValue === 'string') {
      return transformer(hopefulValue);
    }
  }

  // Altfel returnăm fallback (server truth)
  return currentValue;
}
