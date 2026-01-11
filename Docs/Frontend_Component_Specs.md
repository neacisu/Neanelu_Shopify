# Frontend Component Specifications

**Versiune:** 1.0  
**Ultima actualizare:** 04 Ianuarie 2026

---

## 1. Layout Components

### 1.1 AppShell

**Path:** `/apps/web-admin/app/components/layout/app-shell.tsx`

| Prop            | Type         | Required | Default | Description                 |
|-----------------|--------------|----------|---------|-----------------------------|
| children        | `ReactNode`  | ✓        | -       | Main content area           |
| sidebarOpen     | `boolean`    |          | `true`  | Mobile sidebar visibility   |
| onSidebarToggle | `() => void` |          | -       | Callback for sidebar toggle |

**States:**

- Default (sidebar expanded, 280px)
- Collapsed (sidebar hidden on mobile <768px)
- Loading (skeleton content area)

**Accessibility:**

- Skip to content link
- Sidebar navigation uses `<nav role="navigation">`

---

### 1.2 NavLink

**Path:** `/apps/web-admin/app/components/layout/nav-link.tsx`

| Prop     | Type               | Required | Default | Description         |
|----------|--------------------|----------|---------|---------------------|
| to       | `string`           | ✓        | -       | Route path          |
| icon     | `LucideIcon`       |          | -       | Left icon           |
| children | `ReactNode`        | ✓        | -       | Link label          |
| badge    | `number \| string` |          | -       | Right badge (count) |

**States:**

- Default, Hover (bg-muted), Active (border-left, bg-accent), Focus (ring-2)

**Usage:**

```tsx
<NavLink to="/products" icon={Package}>
  Products
</NavLink>
```

---

### 1.3 Breadcrumbs

**Path:** `/apps/web-admin/app/components/layout/breadcrumbs.tsx`

| Prop      | Type                                    | Required | Default            |
|-----------|-----------------------------------------|----------|--------------------|
| items     | `Array<{label: string, href?: string}>` | ✓        | -                  |
| separator | `ReactNode`                             |          | `<ChevronRight />` |

**Accessibility:**

- Uses `<nav aria-label="Breadcrumb">`
- Current page has `aria-current="page"`

---

### 1.4 PageHeader

**Path:** `/apps/web-admin/app/components/layout/page-header.tsx`

| Prop        | Type        | Required | Default |
|-------------|-------------|----------|---------|
| title       | `string`    | ✓        | -       |
| description | `string`    |          | -       |
| actions     | `ReactNode` |          | -       |

---

## 2. Form Components

### 2.1 FieldError

**Path:** `/apps/web-admin/app/components/forms/field-error.tsx`

| Prop      | Type                      | Required | Default |
|-----------|---------------------------|----------|---------|
| name      | `string`                  | ✓        | -       |
| errors    | `Record<string, string[]>`| ✓        | -       |

**Accessibility:**

- `role="alert"` for screen reader announcement
- `aria-describedby` linked from input

**Usage:**

```tsx
<input name="email" aria-describedby="email-error" />
<FieldError name="email" errors={actionData?.errors} />
```

---

### 2.2 FormErrorSummary

**Path:** `/apps/web-admin/app/components/forms/form-error-summary.tsx`

| Prop      | Type                      | Required | Default                           |
|-----------|---------------------------|----------|-----------------------------------|
| errors    | `Record<string, string[]>`| ✓        | -                                 |
| title     | `string`                  |          | "Please fix the following errors" |

**Accessibility:**

- Polaris Banner with `status="critical"`
- Focus moved to summary on submit with errors

---

### 2.3 FormField

**Path:** `/apps/web-admin/app/components/forms/form-field.tsx`

| Prop          | Type                                      | Required | Default |
|---------------|-------------------------------------------|----------|---------|
| id            | `string`                                  | ✓        | -       |
| label         | `string`                                  | ✓        | -       |
| error         | `string \| undefined`                     |          | -       |
| registration  | `UseFormRegisterReturn` (react-hook-form) | ✓        | -       |
| ...inputProps | `InputHTMLAttributes<HTMLInputElement>`   |          | -       |

**States:**

- Default
- Error (shows message + `aria-invalid`)

**Usage:**

```tsx
<FormField
  id="email"
  label="Email"
  type="email"
  registration={register('email')}
  error={formErrors.email?.message}
/>
```

---

### 2.4 SubmitButton

**Path:** `/apps/web-admin/app/components/forms/submit-button.tsx`

| Prop     | Type                                          | Required | Default |
|----------|-----------------------------------------------|----------|---------|
| state    | `'idle' \| 'loading' \| 'success' \| 'error'` | ✓        | -       |
| children | `ReactNode`                                   | ✓        | -       |

**States:**

- Idle
- Loading (spinner, disabled)
- Success (checkmark)
- Error (retry glyph)

**Usage:**

```tsx
<SubmitButton state={submitState}>Save</SubmitButton>
```

---

## 2.5 Pattern Components

### 2.5.1 LoadingState

**Path:** `/apps/web-admin/app/components/patterns/loading-state.tsx`

| Prop     | Type     | Required | Default    |
|----------|----------|----------|------------|
| label    | `string` |          | "Loading…" |

**Usage:**

```tsx
<LoadingState label="Checking health…" />
```

---

### 2.5.2 ErrorState

**Path:** `/apps/web-admin/app/components/patterns/error-state.tsx`

| Prop     | Type         | Required | Default |
|----------|--------------|----------|---------|
| message  | `string`     | ✓        | -       |
| onRetry  | `() => void` |          | -       |

**Usage:**

```tsx
<ErrorState message="Failed to load" onRetry={() => revalidate()} />
```

---

### 2.5.3 EmptyState

**Path:** `/apps/web-admin/app/components/patterns/empty-state.tsx`

| Prop        | Type                                      | Required | Default |
|-------------|-------------------------------------------|----------|---------|
| icon        | `ComponentType<{ className?: string }>`   |          | -       |
| title       | `string`                                  | ✓        | -       |
| description | `ReactNode`                               |          | -       |
| actionLabel | `string`                                  |          | -       |
| onAction    | `() => void`                              |          | -       |

**Usage:**

```tsx
<EmptyState
  title="No ingestion runs yet"
  description="This page will show bulk ingestion status once ingestion flows are implemented."
/>
```

---

## 3. Error Components

### 3.1 SafeComponent

**Path:** `/apps/web-admin/app/components/errors/safe-component.tsx`

| Prop       | Type                                         | Required | Default                      |
|------------|----------------------------------------------|----------|------------------------------|
| children   | `ReactNode`                                  | ✓        | -                            |
| fallback   | `ReactNode`                                  |          | `<ComponentErrorFallback />` |
| onError    | `(error: Error, info: ErrorInfo) => void`    |          | -                            |

**Usage:**

```tsx
<SafeComponent fallback={<ChartPlaceholder />}>
  <MetricsChart data={data} />
</SafeComponent>
```

---

### 3.2 ComponentErrorFallback

**Path:** `/apps/web-admin/app/components/errors/component-error-fallback.tsx`

| Prop               | Type          | Required | Default                       |
|--------------------|---------------|----------|-------------------------------|
| error              | `Error`       |          | -                             |
| resetErrorBoundary | `() => void`  |          | -                             |
| message            | `string`      |          | "This section couldn't load"  |

---

## 4. Domain Components

### 4.1 JobsTable

**Path:** `/apps/web-admin/app/components/domain/jobs-table.tsx`

| Prop          | Type                                         | Required | Default |
|---------------|----------------------------------------------|----------|---------|
| jobs          | `Job[]`                                      | ✓        | -       |
| loading       | `boolean`                                    |          | `false` |
| onRetry       | `(id: string) => void`                       |          | -       |
| onPromote     | `(id: string) => void`                       |          | -       |
| onViewDetails | `(job: Job) => void`                         |          | -       |

**States:**

- Loading (skeleton rows)
- Empty (EmptyState component)
- Error (ErrorState component)

---

### 4.2 MetricCard

**Path:** `/apps/web-admin/app/components/domain/metric-card.tsx`

| Prop          | Type                                         | Required | Default     |
|---------------|----------------------------------------------|----------|-------------|
| title         | `string`                                     | ✓        | -           |
| value         | `string \| number`                           | ✓        | -           |
| trend         | `'up' \| 'down' \| 'neutral'`                |          | `'neutral'` |
| trendValue    | `string`                                     |          | -           |
| icon          | `LucideIcon`                                 |          | -           |
| loading       | `boolean`                                    |          | `false`     |

---

### 4.3 LogConsole

**Path:** `/apps/web-admin/app/components/domain/log-console.tsx`

| Prop          | Type                                         | Required | Default     |
|---------------|----------------------------------------------|----------|-------------|
| logs          | `LogEntry[]`                                 | ✓        | -           |
| maxLines      | `number`                                     |          | `500`       |
| autoScroll    | `boolean`                                    |          | `true`      |
| onClear       | `() => void`                                 |          | -           |

**LogEntry Type:**

```typescript
interface LogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, unknown>;
}
```

---

### 4.4 ProductCard

**Path:** `/apps/web-admin/app/components/domain/product-card.tsx`

| Prop          | Type                                         | Required | Default     |
|---------------|----------------------------------------------|----------|-------------|
| product       | `Product`                                    | ✓        | -           |
| selected      | `boolean`                                    |          | `false`     |
| onSelect      | `(id: string) => void`                       |          | -           |
| onClick       | `(product: Product) => void`                 |          | -           |

---

### 4.5 SearchFilters

**Path:** `/apps/web-admin/app/components/domain/search-filters.tsx`

| Prop          | Type                                         | Required | Default     |
|---------------|----------------------------------------------|----------|-------------|
| filters       | `FilterConfig[]`                             | ✓        | -           |
| values        | `Record<string, unknown>`                    | ✓        | -           |
| onChange      | `(values: Record<string, unknown>) => void`  | ✓        | -           |
| onReset       | `() => void`                                 |          | -           |

---

### 4.6 ShopifyAdminLink

**Path:** `/apps/web-admin/app/components/domain/ShopifyAdminLink.tsx`

| Prop           | Type                      | Required | Default  | Description                                       |
|----------------|---------------------------|----------|----------|---------------------------------------------------|
| resourceType   | `ShopifyResourceType`     | ✓        | -        | Type of Shopify resource (products, orders, etc.) |
| resourceId     | `string \| number`        |          | -        | Resource ID for specific item link                |
| subPath        | `string`                  |          | -        | Sub-path (e.g., 'edit', 'variants')               |
| className      | `string`                  |          | -        | Additional CSS classes                            |
| disabled       | `boolean`                 |          | `false`  | Disables the link                                 |
| fallbackNewTab | `boolean`                 |          | `true`   | Opens in new tab when App Bridge unavailable      |
| title          | `string`                  |          | -        | Title attribute for tooltip                       |
| onClick        | `(e: MouseEvent) => void` |          | -        | Click handler before navigation                   |
| children       | `ReactNode`               | ✓        | -        | Link content                                      |

**ShopifyResourceType:**

```typescript
type ShopifyResourceType =
  | 'products' | 'orders' | 'customers' | 'collections'
  | 'inventory' | 'draft_orders' | 'discounts' | 'gift_cards'
  | 'metafields' | 'files' | 'pages' | 'blogs'
  | 'navigation' | 'themes' | 'settings';
```

**Behavior:**

- When App Bridge is available: Uses `Redirect.Action.ADMIN_PATH` for seamless embedded navigation
- When App Bridge is unavailable: Falls back to opening in new tab (if `fallbackNewTab` is true)
- Automatically builds admin URLs from shop domain in URL params

**Usage:**

```tsx
// Link to products list
<ShopifyAdminLink resourceType="products">
  View Products
</ShopifyAdminLink>

// Link to specific product
<ShopifyAdminLink resourceType="products" resourceId="123456789">
  View Product
</ShopifyAdminLink>

// Link to order edit page
<ShopifyAdminLink resourceType="orders" resourceId="987654321" subPath="edit">
  Edit Order
</ShopifyAdminLink>
```

---

## 5. UI Components

### 5.1 Timeline

**Path:** `/apps/web-admin/app/components/ui/Timeline.tsx`

| Prop             | Type                          | Required | Default                    | Description                              |
|------------------|-------------------------------|----------|----------------------------|------------------------------------------|
| events           | `readonly TimelineEvent[]`    | ✓        | -                          | List of timeline events                  |
| orientation      | `'vertical' \| 'horizontal'`  |          | `'vertical'`               | Timeline layout direction                |
| loading          | `boolean`                     |          | `false`                    | Shows loading state                      |
| loadingState     | `ReactNode`                   |          | -                          | Custom loading element                   |
| loadMore         | `() => void \| Promise<void>` |          | -                          | Infinite scroll callback                 |
| hasMore          | `boolean`                     |          | `false`                    | Whether more events can be loaded        |
| showGroupHeaders | `boolean`                     |          | `true`                     | Group events by day with headers         |
| relativeTime     | `boolean`                     |          | `true`                     | Show relative time (e.g., "2 hours ago") |
| expandable       | `boolean`                     |          | `true`                     | Allow click to expand event details      |
| maxHeight        | `number \| string`            |          | -                          | Max container height                     |
| className        | `string`                      |          | -                          | Additional CSS classes                   |
| emptyState       | `ReactNode`                   |          | -                          | Custom empty state                       |
| timeFormat       | `string`                      |          | `'HH:mm'`                  | date-fns format for time                 |
| dateFormat       | `string`                      |          | `'EEEE, MMMM d, yyyy'`     | date-fns format for date headers         |

**TimelineEvent Type:**

```typescript
type TimelineEvent = Readonly<{
  id: string;
  timestamp: Date | string | number;
  title: string;
  description?: string;
  icon?: ReactNode;
  status?: 'success' | 'error' | 'warning' | 'info' | 'neutral';
  metadata?: Record<string, unknown>;
  children?: ReactNode;
}>;
```

**Features:**

- Automatic grouping by day with "Today", "Yesterday", or full date headers
- Relative timestamps using `formatDistanceToNow` from date-fns
- Expandable event details with metadata display
- Infinite scroll support with `loadMore` callback
- Status-colored dots (success=green, error=red, warning=amber, info=blue, neutral=gray)
- Horizontal and vertical orientations
- Keyboard accessible (Enter/Space to expand)

**Usage:**

```tsx
const events = [
  {
    id: '1',
    timestamp: new Date(),
    title: 'Product updated',
    description: 'Price changed from $10 to $15',
    status: 'success',
    metadata: { productId: '123', field: 'price' },
  },
  {
    id: '2',
    timestamp: new Date(Date.now() - 86400000),
    title: 'Sync completed',
    status: 'info',
  },
];

<Timeline
  events={events}
  showGroupHeaders
  relativeTime
  expandable
  maxHeight={400}
/>
```

---

## 6. Hooks

### 6.1 useJobPolling

```typescript
function useJobPolling(jobId: string, options?: {
  interval?: number;  // default: 2000ms
  enabled?: boolean;  // default: true
}): {
  job: Job | null;
  isPolling: boolean;
  error: Error | null;
  refetch: () => void;
}
```

---

### 6.2 useRecentSearches

```typescript
function useRecentSearches(options?: {
  maxItems?: number;  // default: 10
  key?: string;       // localStorage key
}): {
  searches: string[];
  addSearch: (query: string) => void;
  clearSearches: () => void;
}
```

---

### 6.3 useApiClient

**Path:** `/apps/web-admin/app/hooks/use-api.ts`

```typescript
function useApiClient(options?: {
  baseUrl?: string;   // default: '/api'
}): {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  getJson: <T>(path: string, init?: RequestInit) => Promise<T>;
  getApi: <T>(path: string, init?: RequestInit) => Promise<T>; // expects {success,data,meta}
  postApi: <TResponse, TBody extends Record<string, unknown> | FormData>(
    path: string,
    body: TBody,
    init?: RequestInit
  ) => Promise<TResponse>;
}
```

---

### 6.4 useApiRequest

**Path:** `/apps/web-admin/app/hooks/use-api.ts`

```typescript
function useApiRequest<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): {
  run: (...args: TArgs) => Promise<TResult>;
  data: TResult | undefined;
  error: unknown;
  loading: boolean;
}
```

---

## Changelog

| Date       | Version | Changes                                                                     |
|------------|---------|-----------------------------------------------------------------------------|
| 2025-12-25 | 1.0     | Initial specification                                                       |
| 2026-01-04 | 1.1     | Added API client hooks, state components, and form primitives               |
| 2026-01-11 | 1.2     | Added Timeline (F3.9.3) and ShopifyAdminLink (F3.7.5) - Sprint 5 completion |
