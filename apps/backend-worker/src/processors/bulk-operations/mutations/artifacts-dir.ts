import { mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export async function ensureBulkMutationArtifactsDir(params: {
  shopId: string;
  purpose: 'chunks' | 'results' | 'reports' | 'requeue';
}): Promise<string> {
  const base = process.env['BULK_MUTATION_ARTIFACTS_DIR']?.trim();
  const root = base && base.length > 0 ? base : path.join(os.tmpdir(), 'neanelu-shopify', 'bulk');
  const dir = path.join(root, params.shopId, params.purpose);
  await mkdir(dir, { recursive: true });
  return dir;
}
