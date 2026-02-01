import { describe, expect, it, vi } from 'vitest';

import { copyJsonToClipboard, exportToCSV } from '../utils/export-helpers';

describe('export-helpers', () => {
  it('copies JSON to clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const ok = await copyJsonToClipboard([{ id: '1', title: 'Item', similarity: 0.9 }]);

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalled();
  });

  it('exports CSV by creating a downloadable blob', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock');
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const remove = vi.fn();

    const anchor = {
      href: '',
      download: '',
      click,
      remove,
    } as unknown as HTMLAnchorElement;

    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor);

    exportToCSV([{ id: '1', title: 'Item', similarity: 0.9 }], 'test.csv');

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });
});
