import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const pkgRoot = new URL('..', import.meta.url);
const srcDir = path.resolve(pkgRoot.pathname, 'src');
const distDir = path.resolve(pkgRoot.pathname, 'dist');

async function copyLuaFiles(fromDir: string, toDir: string): Promise<void> {
  await mkdir(toDir, { recursive: true });

  const entries = await readdir(fromDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(fromDir, entry.name);
    const to = path.join(toDir, entry.name);

    if (entry.isDirectory()) {
      await copyLuaFiles(from, to);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.lua')) {
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to);
    }
  }
}

try {
  const s = await stat(distDir);
  if (!s.isDirectory()) process.exit(0);
} catch {
  process.exit(0);
}

await copyLuaFiles(srcDir, distDir);
