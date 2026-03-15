import { expect, test } from '@playwright/test';

import { installLexApiMocks } from './helpers/mock-lex-api';

test('dashboard exposes lexical operator panel and deep-links into lexical workspaces', async ({
  page,
}) => {
  const state = await installLexApiMocks(page);

  await page.goto('/app/?shop=lex-qa.myshopify.com&embedded=0');

  await expect(page.getByText('Operațiuni Lex')).toBeVisible();
  await expect(page.getByText('Lex Degraded')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deschide PIM Translations' })).toBeVisible();

  await page.getByRole('link', { name: 'Deschide PIM Translations' }).click();
  await expect(page).toHaveURL(/\/app\/pim\/translations\?tab=overview/);
  await expect(page.getByText('Translation Intelligence')).toBeVisible();

  await page.goto('/app/?shop=lex-qa.myshopify.com&embedded=0');
  await page.getByRole('link', { name: 'Vezi cozi' }).click();
  await expect(page).toHaveURL(/\/app\/queues\?tab=overview/);
  await expect
    .poll(() => state.calls.some((call) => call.path === '/queues' && call.method === 'GET'))
    .toBeTruthy();
});
