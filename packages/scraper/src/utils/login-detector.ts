import { load } from 'cheerio';

import type { LoginDetectionResult, PageLike } from '../scrapers/types.js';

const LOGIN_KEYWORDS = ['login', 'signin', 'authenticate', 'oauth', 'authorize'];

function includesLoginKeyword(value: string): boolean {
  const normalized = value.toLowerCase();
  return LOGIN_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function isLoginPageFromHtml(html: string): LoginDetectionResult {
  const $ = load(html);

  if ($('input[type="password"]').length > 0) {
    return { isLoginPage: true, reason: 'password_input' };
  }

  const formAction = $('form[action]')
    .toArray()
    .some((el) => {
      const action = $(el).attr('action');
      return action ? includesLoginKeyword(action) : false;
    });
  if (formAction) {
    return { isLoginPage: true, reason: 'form_action_login' };
  }

  const metaRefresh = $('meta[http-equiv="refresh"]')
    .toArray()
    .some((el) => {
      const content = ($(el).attr('content') ?? '').toLowerCase();
      return includesLoginKeyword(content);
    });
  if (metaRefresh) {
    return { isLoginPage: true, reason: 'meta_refresh_login' };
  }

  return { isLoginPage: false };
}

export async function isLoginPage(page: PageLike): Promise<LoginDetectionResult> {
  const response = page.response ? await page.response() : null;
  const status = response?.status();
  if (status === 401 || status === 403) {
    return { isLoginPage: true, reason: `http_${String(status)}` };
  }

  const finalUrl = page.url();
  if (includesLoginKeyword(finalUrl)) {
    return { isLoginPage: true, reason: 'redirect_login_url' };
  }

  const html = await page.content();
  return isLoginPageFromHtml(html);
}
