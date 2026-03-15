function getBasePrefix(): string {
  const rawBase = (import.meta.env.BASE_URL as string | undefined) ?? '/';
  if (rawBase === '/' || rawBase.length === 0) return '';
  return rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
}

export function withAppBasePath(path: string | null | undefined): string {
  if (!path) return '';
  if (/^(https?:)?\/\//.test(path) || path.startsWith('mailto:') || path.startsWith('#')) {
    return path;
  }

  const prefix = getBasePrefix();
  if (!prefix) return path;
  if (path === prefix || path.startsWith(`${prefix}/`)) return path;
  if (path === '/') return `${prefix}/`;
  return path.startsWith('/') ? `${prefix}${path}` : `${prefix}/${path}`;
}
