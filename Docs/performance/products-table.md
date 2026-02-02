# Products Table Performance

## Benchmark Results (10k+ products)

| Metric         | Target   | Actual |
| -------------- | -------- | ------ |
| Initial render | < 1000ms | TBD    |
| Visible rows   | < 100    | TBD    |

## Virtualization Strategy

- Library: `@tanstack/react-virtual`
- Fixed row height: 72px
- Overscan: 10 rows
- Visible window: ~15-25 rows

## Testing

Run the performance test:

```bash
pnpm --filter web-admin test -- --run --testNamePattern "ProductsTable performance"
```
