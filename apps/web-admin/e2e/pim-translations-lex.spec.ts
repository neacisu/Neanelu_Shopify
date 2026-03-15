import { expect, test } from '@playwright/test';

import { installLexApiMocks } from './helpers/mock-lex-api';

test('governance flow supports submit, approve, and apply from the lexical workspace', async ({
  page,
}) => {
  const state = await installLexApiMocks(page);

  await page.goto('/app/pim/translations?tab=governance&shop=lex-qa.myshopify.com&embedded=0');

  await expect(page.getByText('Global Canon Governance')).toBeVisible();
  await expect(page.getByText('status draft')).toBeVisible();

  await page.getByRole('button', { name: 'Submit' }).click();
  await expect.poll(() => state.governanceRequests[0]?.status).toBe('pending_approval');
  await expect(page.getByText('status pending_approval')).toBeVisible();

  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => state.governanceRequests[0]?.status).toBe('approved');
  await expect(page.getByText('status approved')).toBeVisible();

  await page.getByRole('button', { name: 'Apply Canon' }).click();
  await expect.poll(() => state.governanceRequests[0]?.status).toBe('applied');
  await expect(page.getByText('status applied')).toBeVisible();
});

test('review decisions and publication rollback run through the lexical operator surface', async ({
  page,
}) => {
  const state = await installLexApiMocks(page);

  await page.goto(
    '/app/pim/translations?tab=review&reviewId=review-1&shop=lex-qa.myshopify.com&embedded=0'
  );

  await expect(page.getByText('Review Queue')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();

  await expect.poll(() => state.publications[0]?.status).toBe('pending');

  await page.goto(
    '/app/pim/translations?tab=publications&publicationId=pub-1&shop=lex-qa.myshopify.com&embedded=0'
  );

  await expect(page.getByText('Publication Detail')).toBeVisible();
  await expect(page.getByText('rollback enabled')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Queue' })).toHaveAttribute(
    'href',
    '/app/queues?tab=jobs&queue=lex.publish'
  );

  await page.getByRole('button', { name: 'Rollback' }).first().click();
  await expect.poll(() => state.publicationDetail.status).toBe('rolled_back');
  await expect(page.getByText('already_rolled_back')).toBeVisible();
});
