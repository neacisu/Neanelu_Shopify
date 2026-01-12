import FormData from 'form-data';
import { createReadStream } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';

export type StagedUploadTarget = Readonly<{
  url: string;
  resourceUrl: string;
  parameters: readonly Readonly<{ name: string; value: string }>[];
}>;

export function buildStagedUploadsCreateMutation(): string {
  return `mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters { name value }
    }
    userErrors { field message }
  }
}`;
}

export function buildBulkRunMutationMutation(): string {
  return `mutation BulkRunMutation($mutation: String!, $stagedUploadPath: String!) {
  bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) {
    bulkOperation { id status }
    userErrors { field message }
  }
}`;
}

export async function uploadJsonlToStagedTarget(params: {
  target: StagedUploadTarget;
  filePath: string;
  timeoutMs?: number;
}): Promise<void> {
  const timeoutMs =
    typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
      ? Math.max(1_000, Math.floor(params.timeoutMs))
      : 120_000;

  const form = new FormData();
  for (const p of params.target.parameters) {
    form.append(p.name, p.value);
  }

  // Shopify expects the file field name to be `file`.
  form.append('file', createReadStream(params.filePath), {
    filename: 'variables.jsonl',
    contentType: 'text/jsonl',
  });

  const url = new URL(params.target.url);
  const requestFn = url.protocol === 'https:' ? https.request : http.request;

  const headers = form.getHeaders();
  const contentLength = await new Promise<number | null>((resolve) => {
    form.getLength((err, length) => {
      if (err) return resolve(null);
      if (typeof length !== 'number' || !Number.isFinite(length)) return resolve(null);
      resolve(Math.max(0, Math.floor(length)));
    });
  });
  if (contentLength != null) {
    headers['content-length'] = String(contentLength);
  }

  await new Promise<void>((resolve, reject) => {
    const req = requestFn(
      {
        method: 'POST',
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: `${url.pathname}${url.search}`,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve();
          const body = Buffer.concat(chunks).toString('utf8');
          reject(
            new Error(
              `staged_upload_failed status=${status} url=${params.target.url} body=${body.slice(0, 2000)}`
            )
          );
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('staged_upload_timeout'));
    });

    req.on('error', reject);

    form.pipe(req);
  });
}
