# ADR 002: Strategia Hibridă de Data Fetching (RR7 Loaders + TanStack Query)

**Status:** Accepted
**Data:** 2026-01-09
**Context:** PR-031 / Sprint 5

## Context

Aplicația `web-admin` este construită pe React Router v7 (framework mode), care oferă un mecanism puternic de `loaders` (pentru data fetching la nivel de rută) și `actions` (pentru mutații).
Totuși, aplicația necesită funcționalități avansate de gestionare a stării serverului pe client, în special pentru:

- Polling pentru statusul job-urilor de lungă durată (bulk operations, importuri).
- Revalidare inteligentă a datelor fără reload complet de rută.
- Caching granular și dedup-ing de request-uri.
- Infinite scroll performing (pentru liste virtualizate).

## Decizie

Vom adopta o **abordare hibridă**, utilizând **React Router 7 Loaders** împreună cu **TanStack Query (v5)**.

### 1. Rolul React Router 7 (Loaders & Actions)

- **Data Fetching Inițial (Critical Path):** Loaders vor fi folosiți pentru a încărca datele esențiale necesare randării inițiale a rutei. Aceasta asigură că user-ul nu vede un layout gol și beneficiază de mecanismul de `HydrateFallback`.
- **Server-Side Rendering (dacă va fi cazul):** Loaders sunt compatibili nativ cu SSR.
- **Mutații Simple (Actions):** Form actions (`<Form>`) vor fi folosite pentru operații CRUD standard care implică redirect sau invalidare simplă.

### 2. Rolul TanStack Query

- **Client-Side Cache & State Management:** Datele aduse de loaders pot fi "hidratate" în cache-ul React Query (`initialData`) sau, preferabil, React Query va fi folosit independent pentru componente care nu sunt strict legate de URL (ex: widget-uri dashboard, notificări, status bar).
- **Polling & Real-time:** Hook-ul `useQuery` cu opțiunea `refetchInterval` va fi mecanismul standard pentru polling.
- **Granular Loading States:** Pentru widget-uri izolate care se încarcă individual (și nu blochează navigarea).
- **Background Refetching:** `refetchOnWindowFocus`, `staleTime` configurabil.

## Implementare Tehnică

- `QueryClient` va fi instanțiat global în aplicație.
- Se va crea un hook `usePolling` wrapuit peste `useQuery` pentru a standardiza logica de oprire a polling-ului.
- Pattern-ul de utilizare:

  ```typescript
  // Exemplu Loaders + Query
  export async function loader({ params }: Route.LoaderArgs) {
    const data = await db.getProduct(params.id);
    return { product: data };
  }

  export default function ProductPage({ loaderData }: Route.ComponentProps) {
    // Folosim datele din loader, dar putem activa Query pentru updates
    const { data } = useQuery({
      queryKey: ['product', loaderData.product.id],
      queryFn: () => fetchProduct(loaderData.product.id),
      initialData: loaderData.product,
    });
    // ...
  }
  ```

  _Nota bene:_ Deși pattern-ul de mai sus este posibil, pentru simplificare inițială, vom folosi Query predominant acolo unde Loaders nu oferă funcționalitate nativă (polling).

## Consecințe

**Avantaje:**

- Separare clară a responsabilităților.
- Performanță (nu reîncărcăm toată pagina pentru un status update).
- UX superior (date "stale" afișate instant în timp ce se face refetch în fundal).

**Dezavantaje:**

- Bundle size crescut ușor (TanStack Query).
- Complexitate mentală (două moduri de a aduce date). -> Se rezolvă prin convenție: **"Rută = Loader, Componentă/Polling = Query"**.

## Status

Acceptat pentru implementare în Sprint 5.
