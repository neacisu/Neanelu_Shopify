import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { loadXAICredentials } from '../../services/xai-credentials.js';
import {
  PIM_DESCRIPTION_GENERATOR_JOB,
  PIM_DESCRIPTION_GENERATOR_QUEUE_NAME,
} from '../../queue/description-generator-queue.js';

type DescriptionGeneratorPayload = Readonly<{
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}>;

type ProductContext = Readonly<{
  id: string;
  canonical_title: string;
  brand: string | null;
  specs: Record<string, unknown> | null;
}>;

type TemplateContext = Readonly<{
  id: string;
  locale: string;
  min_chars: number;
  max_chars: number;
  required_sections: string[] | null;
  tone: string | null;
  prompt_template: string;
}>;

type XaiCredentials = Readonly<{
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokensPerRequest: number;
}>;

type XaiResponse = Readonly<{
  choices?: readonly Readonly<{
    message?: Readonly<{
      content?: string | null;
    }> | null;
  }>[];
}>;

export interface DescriptionGeneratorWorkerHandle {
  worker: { close: () => Promise<void>; isRunning?: () => boolean };
  close: () => Promise<void>;
}

export function startDescriptionGeneratorWorker(logger: Logger): DescriptionGeneratorWorkerHandle {
  const env = loadEnv();
  const { worker } = createWorker(
    { config: configFromEnv(env) },
    {
      name: PIM_DESCRIPTION_GENERATOR_QUEUE_NAME,
      enableDlq: true,
      enableDelayHandling: true,
      processor: async (job) =>
        await withJobTelemetryContext(job, async () => {
          const jobId = String(job.id ?? job.name);
          setWorkerCurrentJob('pim-description-generator-worker', {
            jobId,
            jobName: job.name,
            startedAtIso: new Date().toISOString(),
            progressPct: null,
          });
          try {
            if (job.name !== PIM_DESCRIPTION_GENERATOR_JOB) {
              throw new Error(`unknown_description_generator_job:${job.name}`);
            }

            const payload = job.data as DescriptionGeneratorPayload | null;
            if (!payload?.shopId || !payload.productId) {
              throw new Error('invalid_description_generator_payload');
            }

            await processDescriptionGeneration(payload, logger);
          } finally {
            clearWorkerCurrentJob('pim-description-generator-worker');
          }
        }),
    }
  );

  return { worker, close: async () => await worker.close() };
}

async function processDescriptionGeneration(
  payload: DescriptionGeneratorPayload,
  logger: Logger
): Promise<void> {
  const env = loadEnv();
  const credentials = (await loadXAICredentials({
    shopId: payload.shopId,
    encryptionKeyHex: env.encryptionKeyHex,
  })) as XaiCredentials | null;
  if (!credentials?.apiKey) {
    return;
  }

  const [product, template] = await withTenantContext(payload.shopId, async (client) => {
    const productRes = await client.query<ProductContext>(
      `SELECT pm.id,
              pm.canonical_title,
              pm.brand,
              psn.specs
       FROM prod_master pm
       LEFT JOIN prod_specs_normalized psn
         ON psn.product_id = pm.id
        AND psn.is_current = true
       WHERE pm.id = $1
       LIMIT 1`,
      [payload.productId]
    );

    const templateRes = await client.query<TemplateContext>(
      `SELECT id,
              locale,
              min_chars,
              max_chars,
              required_sections,
              tone,
              prompt_template
       FROM pim_description_templates
       WHERE is_active = true
         AND (shop_id = $1 OR shop_id IS NULL)
       ORDER BY (shop_id IS NULL) ASC, updated_at DESC
       LIMIT 1`,
      [payload.shopId]
    );

    return [productRes.rows[0] ?? null, templateRes.rows[0] ?? null] as const;
  });

  if (!product || !template) {
    return;
  }

  const prompt = buildDescriptionPrompt({
    template: template.prompt_template,
    title: product.canonical_title,
    brand: product.brand ?? '',
    specs: JSON.stringify(product.specs ?? {}),
    minChars: template.min_chars,
    maxChars: template.max_chars,
    requiredSections: (template.required_sections ?? []).join(', '),
    tone: template.tone ?? 'professional',
  });

  const response = await fetch(`${credentials.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: credentials.model,
      temperature: credentials.temperature,
      max_tokens: Math.max(300, Math.min(credentials.maxTokensPerRequest, 1800)),
      messages: [
        {
          role: 'system',
          content:
            'Generezi descrieri de produs profesioniste. Nu inventezi specificatii lipsa si folosesti doar datele furnizate.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) {
    logger.warn({ productId: payload.productId }, 'xAI description generation failed');
    return;
  }

  const body = (await response.json()) as XaiResponse;
  const generatedRaw = body.choices?.[0]?.message?.content?.trim() ?? '';
  if (!generatedRaw) {
    return;
  }

  const generated = generatedRaw.slice(0, template.max_chars);

  await withTenantContext(payload.shopId, async (client) => {
    await client.query(
      `INSERT INTO prod_semantics (
         product_id,
         title_master,
         description_master,
         locale,
         template_id,
         generated_by,
         generated_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'xai_description_generator', now(), now())
       ON CONFLICT (product_id) DO UPDATE SET
         description_master = EXCLUDED.description_master,
         locale = EXCLUDED.locale,
         template_id = EXCLUDED.template_id,
         generated_by = EXCLUDED.generated_by,
         generated_at = EXCLUDED.generated_at,
         updated_at = now()`,
      [payload.productId, product.canonical_title, generated, template.locale, template.id]
    );
  });
}

function buildDescriptionPrompt(params: {
  template: string;
  title: string;
  brand: string;
  specs: string;
  minChars: number;
  maxChars: number;
  requiredSections: string;
  tone: string;
}): string {
  return params.template
    .replaceAll('{{title}}', params.title)
    .replaceAll('{{brand}}', params.brand)
    .replaceAll('{{specs}}', params.specs)
    .replaceAll('{{min_chars}}', String(params.minChars))
    .replaceAll('{{max_chars}}', String(params.maxChars))
    .replaceAll('{{required_sections}}', params.requiredSections)
    .replaceAll('{{tone}}', params.tone);
}
