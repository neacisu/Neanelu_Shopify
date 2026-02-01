import type { ProductSearchResult } from '@app/types';

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeExportRow(result: ProductSearchResult) {
  return {
    id: result.id,
    title: result.title,
    similarity: result.similarity,
    vendor: result.vendor ?? '',
    productType: result.productType ?? '',
    priceMin: result.priceRange?.min ?? '',
    priceMax: result.priceRange?.max ?? '',
    priceCurrency: result.priceRange?.currency ?? '',
  };
}

export function exportToCSV(data: ProductSearchResult[], filename: string): void {
  const rows = data.map(normalizeExportRow);
  const header = Object.keys(rows[0] ?? {}).join(',');
  const csvRows = rows.map((row) =>
    Object.values(row)
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [header, ...csvRows].join('\n');
  downloadFile(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

export function exportToJSON(data: ProductSearchResult[], filename: string): void {
  const payload = data.map(normalizeExportRow);
  const json = JSON.stringify(payload, null, 2);
  downloadFile(new Blob([json], { type: 'application/json;charset=utf-8;' }), filename);
}

export async function copyJsonToClipboard(data: ProductSearchResult[]): Promise<boolean> {
  try {
    const payload = data.map(normalizeExportRow);
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    return true;
  } catch {
    return false;
  }
}
