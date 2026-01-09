# Strategie de Cache și Invalidare (RR7 + TanStack Query)

## Principii Generale

Aplicația folosește o arhitectură hibridă:

1. **React Router 7 (Loaders):** Sursă de adevăr pentru datele la navigare (URL-driven).
2. **TanStack Query:** Gestionarea stării asincrone "vii" (polling, background updates, componente izolate).

## Când invalidăm Cache-ul?

### 1. După Mutații (Actions)

Când o acțiune (ex: `POST /api/settings`) modifică datele pe server, trebuie să actualizăm UI-ul.

**Strategie:**

- **Revalidare RR7:** Implicită. React Router re-rulează toți loaderii activi după un Action submission (`<Form>`).
- **Invalidare Query:** Dacă datele modificate sunt folosite și într-un `useQuery` (ex: polling la job status), Action-ul trebuie să triggeruiască și invalidarea React Query.

```typescript
// Exemplu în action
export async function action({ request }: ActionArgs) {
  await updateSettings(request);
  // RR7 revalidează automat loaderii.
  // Dacă avem polling pe settings, invalidăm și cache-ul granular:
  // await invalidateQueries(QueryKeys.settings);
  return { ok: true };
}
```

### 2. După Evenimente (Polling / SSE)

Când `usePolling` detectează o schimbare (ex: Job status `completed`), putem invalida liste conexe.

- Nu este necesară intervenția manuală dacă query keys sunt corecte.

## Utilizare `useOptimisticAction`

Pentru UX fluid, afișăm datele _ca și cum_ mutația a reușit, înainte de răspunsul serverului.

**Scenariu:** Userul dă click pe "Retry Job".
**Fără Optimistic:** Loading spinner (2s) -> Refresh listă.
**Cu Optimistic:** Status devine "Retrying" instant (UI) -> Request în background -> Revalidare reală.

Hook-ul `useOptimisticAction` detectează `fetcher.formData` și suprascrie temporar datele afișate.

## Chei de Cache (QueryKeys)

Toate cheile sunt centralizate în `apps/web-admin/app/lib/cache-strategy.ts`.
NU hardcodați string-uri ("jobs") prin componente. Folosiți `QueryKeys.jobs()`.
