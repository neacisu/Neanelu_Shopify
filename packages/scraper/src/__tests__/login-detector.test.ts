import { describe, expect, it } from 'vitest';

import { isLoginPageFromHtml } from '../utils/login-detector.js';

describe('isLoginPageFromHtml', () => {
  it('detects password input forms', () => {
    const result = isLoginPageFromHtml('<form><input type="password" /></form>');
    expect(result.isLoginPage).toBe(true);
  });

  it('does not flag regular pages', () => {
    const result = isLoginPageFromHtml('<div>Product page</div>');
    expect(result.isLoginPage).toBe(false);
  });
});
