// Optional dependency typing stub.
//
// This project intentionally does not require Playwright to be installed
// unless you run the admin scraping script. Without this stub, TypeScript
// reports: "Cannot find module 'playwright'".
//
// If you actually want to run the scraper, install Playwright:
//   pnpm add -D playwright
//   pnpm exec playwright install chromium

declare module 'playwright' {
  export const chromium: any;
  export const firefox: any;
  export const webkit: any;
  const _default: any;
  export default _default;
}
