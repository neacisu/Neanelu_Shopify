import { loadEnv } from '@app/config';
import { withTenantContext } from '@app/database';
import type { Logger } from '@app/logger';
import { UnrecoverableError } from 'bullmq';
import { configFromEnv, createWorker, withJobTelemetryContext } from '@app/queue-manager';
import { clearWorkerCurrentJob, setWorkerCurrentJob } from '../../runtime/worker-registry.js';
import { consensusChatCompletion } from '../../services/consensus-engine.js';
import {
  PIM_DESCRIPTION_GENERATOR_JOB,
  PIM_DESCRIPTION_GENERATOR_QUEUE_NAME,
} from '../../queue/description-generator-queue.js';

type DescriptionGeneratorPayload = Readonly<{
  shopId: string;
  productId: string;
  trigger: 'consensus' | 'manual';
}>;

type RetryAwareJobLike = Readonly<{
  attemptsMade?: number;
  opts?: { attempts?: number };
}>;

type DescriptionGenerationAttemptContext = Readonly<{
  currentAttempt: number;
  maxAttempts: number;
  isFinalAttempt: boolean;
}>;

type ProductContext = Readonly<{
  id: string;
  canonical_title: string;
  brand: string | null;
  specs: Record<string, unknown> | null;
  source_description: string | null;
  source_description_html: string | null;
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

            const attemptContext = resolveAttemptContext(job as RetryAwareJobLike | null);
            await processDescriptionGeneration(payload, logger, attemptContext);
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
  logger: Logger,
  attemptContext: DescriptionGenerationAttemptContext
): Promise<void> {
  const env = loadEnv();
  const startedAt = Date.now();
  logger.info(
    {
      productId: payload.productId,
      shopId: payload.shopId,
      trigger: payload.trigger,
      attempt: attemptContext.currentAttempt,
      maxAttempts: attemptContext.maxAttempts,
      finalAttempt: attemptContext.isFinalAttempt,
    },
    'description_generation_started'
  );

  const [product, template] = await withTenantContext(payload.shopId, async (client) => {
    const productRes = await client.query<ProductContext>(
      `SELECT pm.id,
              pm.canonical_title,
              pm.brand,
              psn.specs,
              sp.description as source_description,
              sp.description_html as source_description_html
       FROM prod_master pm
       LEFT JOIN prod_specs_normalized psn
         ON psn.product_id = pm.id
        AND psn.is_current = true
       LEFT JOIN prod_channel_mappings pcm
         ON pcm.product_id = pm.id
        AND pcm.channel = 'shopify'
        AND pcm.shop_id = $2
       LEFT JOIN shopify_products sp
         ON sp.shopify_gid = pcm.external_id
        AND sp.shop_id = pcm.shop_id
       WHERE pm.id = $1
       LIMIT 1`,
      [payload.productId, payload.shopId]
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

  if (!product) {
    logger.warn({ productId: payload.productId }, 'description_generation_product_not_found');
    throw new UnrecoverableError('description_generation_product_not_found');
  }
  if (!template) {
    logger.warn(
      { productId: payload.productId, shopId: payload.shopId },
      'description_generation_template_not_found'
    );
    throw new UnrecoverableError('description_generation_template_not_found');
  }

  const sourceDescription = resolveSourceDescription({
    description: product.source_description,
    descriptionHtml: product.source_description_html,
  });
  const targets = resolveDescriptionTargets({
    minChars: template.min_chars,
    maxChars: template.max_chars,
    sourceDescription,
  });
  const maxTokens = Math.max(2000, Math.min(Math.ceil(targets.maxChars / 2.8) + 1000, 8000));
  const prompt = buildDescriptionPrompt({
    template: template.prompt_template,
    title: product.canonical_title,
    brand: product.brand ?? '',
    specs: JSON.stringify(product.specs ?? {}),
    sourceDescription,
    sourceDescriptionLength: sourceDescription.length,
    minChars: targets.minChars,
    maxChars: targets.maxChars,
    requiredSections: (template.required_sections ?? []).join(', '),
    tone: template.tone ?? 'professional',
  });
  logger.info(
    {
      productId: payload.productId,
      templateId: template.id,
      locale: template.locale,
      maxTokens,
      promptLengthChars: prompt.length,
      sourceDescriptionLength: sourceDescription.length,
      targetMinChars: targets.minChars,
      targetMaxChars: targets.maxChars,
    },
    'description_generation_prompt_built'
  );
  logger.info(
    { productId: payload.productId, maxTokens },
    'description_generation_consensus_started'
  );
  let consensus;
  try {
    consensus = await consensusChatCompletion<string>({
      shopId: payload.shopId,
      env,
      logger,
      taskType: 'description',
      systemPrompt:
        'Generezi descrieri Golden Record in romana. Pornesti de la descrierea originala existenta, o restructurezi si o imbogatesti fara sa pierzi informatii factuale utile. Nu mentionezi magazinul, pretul, stocul sau disponibilitatea daca nu sunt esentiale pentru descrierea produsului. Returnezi STRICT JSON cu cheia description. Valoarea description trebuie sa contina exclusiv descrierea finala in romana, text simplu, fara markdown, fara titluri cu ###, fara rationament intermediar si fara alte campuri.',
      userPrompt: prompt,
      responseFormat: { type: 'json_object' },
      parseResponse: parseDescriptionEnvelope,
      maxTokens,
      compareValue: (value) => value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 600),
    });
  } catch (err: unknown) {
    logger.error(
      {
        productId: payload.productId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'description_generation_consensus_error'
    );
    throw err instanceof Error ? err : new Error(String(err));
  }

  logger.info(
    {
      productId: payload.productId,
      method: consensus.method,
      consensusScore: consensus.consensusScore,
      participantCount: consensus.participantCount,
      generatedLengthChars: consensus.result.trim().length,
      durationMs: consensus.durationMs,
    },
    'description_generation_consensus_completed'
  );

  const generatedRaw = normalizeGeneratedDescriptionText(consensus.result);
  const sourceFallbackDescription = sourceDescription.trim().slice(0, targets.maxChars);

  let descriptionToPersist: string;
  let generatedBy: 'llm_description_generator' | 'source_description_fallback';

  if (!generatedRaw) {
    if (attemptContext.isFinalAttempt && sourceFallbackDescription.length > 0) {
      descriptionToPersist = sourceFallbackDescription;
      generatedBy = 'source_description_fallback';
      logger.warn(
        {
          productId: payload.productId,
          attempt: attemptContext.currentAttempt,
          maxAttempts: attemptContext.maxAttempts,
          sourceDescriptionLength: sourceDescription.length,
        },
        'description_generation_empty_output_source_fallback'
      );
    } else {
      throw new Error('description_generation_empty_output');
    }
  } else {
    const generated = generatedRaw.slice(0, targets.maxChars);
    const qualityGate = evaluateGeneratedDescriptionQuality({
      sourceDescription,
      generatedDescription: generated,
      maxChars: targets.maxChars,
    });

    if (!qualityGate.accepted) {
      if (!attemptContext.isFinalAttempt) {
        logger.warn(
          {
            productId: payload.productId,
            attempt: attemptContext.currentAttempt,
            maxAttempts: attemptContext.maxAttempts,
            sourceDescriptionLength: qualityGate.sourceLength,
            generatedLength: qualityGate.generatedLength,
            minimumAcceptedLength: qualityGate.minimumAcceptedLength,
          },
          'description_generation_quality_gate_retry'
        );
        throw new Error('description_generation_too_short_compared_to_source');
      }

      descriptionToPersist = qualityGate.sourceFallback;
      generatedBy = 'source_description_fallback';
      logger.warn(
        {
          productId: payload.productId,
          attempt: attemptContext.currentAttempt,
          maxAttempts: attemptContext.maxAttempts,
          sourceDescriptionLength: qualityGate.sourceLength,
          generatedLength: qualityGate.generatedLength,
          minimumAcceptedLength: qualityGate.minimumAcceptedLength,
        },
        'description_generation_quality_gate_source_fallback'
      );
    } else {
      descriptionToPersist = generated;
      generatedBy = 'llm_description_generator';
    }
  }

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
       VALUES ($1, $2, $3, $4, $5, $6, now(), now())
       ON CONFLICT (product_id) DO UPDATE SET
         description_master = EXCLUDED.description_master,
         locale = EXCLUDED.locale,
         template_id = EXCLUDED.template_id,
         generated_by = EXCLUDED.generated_by,
         generated_at = EXCLUDED.generated_at,
         updated_at = now()`,
      [
        payload.productId,
        product.canonical_title,
        descriptionToPersist,
        template.locale,
        template.id,
        generatedBy,
      ]
    );
  });
  logger.info(
    {
      productId: payload.productId,
      locale: template.locale,
      templateId: template.id,
      descriptionLength: descriptionToPersist.length,
      generatedBy,
      totalDurationMs: Date.now() - startedAt,
    },
    'description_generation_saved'
  );
}

function resolveAttemptContext(job: RetryAwareJobLike | null): DescriptionGenerationAttemptContext {
  const maxAttempts =
    typeof job?.opts?.attempts === 'number' && job.opts.attempts > 0 ? job.opts.attempts : 1;
  const currentAttempt = typeof job?.attemptsMade === 'number' ? job.attemptsMade + 1 : 1;
  return {
    currentAttempt,
    maxAttempts,
    isFinalAttempt: currentAttempt >= maxAttempts,
  };
}

function normalizeGeneratedDescriptionText(value: string): string {
  return value
    .replace(/```(?:json)?/gi, ' ')
    .replace(/```/g, ' ')
    .replace(/^[ \t]*#{1,6}\s*(.+?)\s*$/gm, '$1:')
    .replace(/^[ \t]*[-*]\s+/gm, '')
    .replace(/^[ \t]*\d+\.\s+/gm, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractLastJsonObjectString(text: string): string | null {
  const lastClose = text.lastIndexOf('}');
  if (lastClose === -1) return null;
  let depth = 0;
  for (let i = lastClose; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) {
        return text.slice(i, lastClose + 1);
      }
    }
  }
  return null;
}

function tryParseStructuredDescription(raw: string): string | null {
  const stripped = stripThinkBlocks(raw);
  const rawTrimmed = raw.trim();
  const candidates: (string | null)[] = [
    stripped,
    rawTrimmed,
    /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped)?.[1]?.trim() ?? null,
    extractLastJsonObjectString(stripped),
    /```(?:json)?\s*([\s\S]*?)```/i.exec(rawTrimmed)?.[1]?.trim() ?? null,
    extractLastJsonObjectString(rawTrimmed),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const description = (parsed as Record<string, unknown>)['description'];
      if (typeof description !== 'string') {
        continue;
      }
      const normalized = normalizeGeneratedDescriptionText(description);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function parseDescriptionEnvelope(raw: string): string {
  const structured = tryParseStructuredDescription(raw);
  if (structured) {
    return structured;
  }

  const afterStrip = stripThinkBlocks(raw);
  const trimmed = (afterStrip || raw).trim();
  if (!trimmed) {
    throw new Error('description_generation_empty_description');
  }

  if (/^[{[]/.test(trimmed) || /```json/i.test(trimmed)) {
    throw new Error('description_generation_invalid_json');
  }

  if (/"description"\s*:/.test(trimmed)) {
    throw new Error('description_generation_invalid_json');
  }

  const normalized = normalizeGeneratedDescriptionText(trimmed);
  if (!normalized) {
    throw new Error('description_generation_empty_description');
  }

  return normalized;
}

function evaluateGeneratedDescriptionQuality(params: {
  sourceDescription: string;
  generatedDescription: string;
  maxChars: number;
}): {
  accepted: boolean;
  sourceLength: number;
  generatedLength: number;
  minimumAcceptedLength: number;
  sourceFallback: string;
} {
  const sourceFallback = params.sourceDescription.trim().slice(0, params.maxChars);
  const sourceLength = sourceFallback.length;
  const generatedLength = params.generatedDescription.trim().length;

  if (sourceLength < 700) {
    return {
      accepted: true,
      sourceLength,
      generatedLength,
      minimumAcceptedLength: 0,
      sourceFallback,
    };
  }

  const minimumAcceptedLength = Math.min(
    params.maxChars,
    Math.max(600, sourceLength - 250, Math.floor(sourceLength * 0.85))
  );

  return {
    accepted: generatedLength >= minimumAcceptedLength,
    sourceLength,
    generatedLength,
    minimumAcceptedLength,
    sourceFallback,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ');
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function resolveSourceDescription(params: {
  description: string | null;
  descriptionHtml: string | null;
}): string {
  const plain = params.description?.trim() ?? '';
  if (plain.length > 0) {
    return plain;
  }
  const fromHtml = params.descriptionHtml?.trim() ? stripHtmlToText(params.descriptionHtml) : '';
  return fromHtml;
}

function resolveDescriptionTargets(params: {
  minChars: number;
  maxChars: number;
  sourceDescription: string;
}): { minChars: number; maxChars: number } {
  const sourceLength = params.sourceDescription.trim().length;
  const dynamicMax =
    sourceLength > 0
      ? Math.min(Math.max(params.maxChars, sourceLength + 1200), 8000)
      : params.maxChars;
  const dynamicMin =
    sourceLength > 0
      ? Math.min(dynamicMax, Math.max(params.minChars, Math.min(sourceLength + 250, 6000)))
      : params.minChars;
  return {
    minChars: dynamicMin,
    maxChars: dynamicMax,
  };
}

function buildDescriptionPrompt(params: {
  template: string;
  title: string;
  brand: string;
  specs: string;
  sourceDescription: string;
  sourceDescriptionLength: number;
  minChars: number;
  maxChars: number;
  requiredSections: string;
  tone: string;
}): string {
  const templatePrompt = params.template
    .replaceAll('{{title}}', params.title)
    .replaceAll('{{brand}}', params.brand)
    .replaceAll('{{specs}}', params.specs)
    .replaceAll(
      '{{source_description}}',
      params.sourceDescription || 'Nu exista descriere originala disponibila.'
    )
    .replaceAll('{{source_description_length}}', String(params.sourceDescriptionLength))
    .replaceAll('{{min_chars}}', String(params.minChars))
    .replaceAll('{{max_chars}}', String(params.maxChars))
    .replaceAll('{{required_sections}}', params.requiredSections)
    .replaceAll('{{tone}}', params.tone);

  return [
    templatePrompt,
    'Obiectiv Golden Record: porneste de la descrierea originala existenta ca sursa principala si livreaza o versiune mai clara, mai structurata si cel putin la fel de informativa.',
    'Nu rezuma agresiv. Pastreaza toate informatiile factuale utile din sursa: moduri de functionare, materiale, siguranta, mentenanta, instalare, dimensiuni, garantie, limitari si recomandari de utilizare, daca exista.',
    'Daca lipseste descrierea originala, foloseste strict specificatiile si titlul fara a inventa.',
    'Nu mentiona magazinul, disponibilitatea, promotii sau formularea comerciala de listare decat daca apar explicit in descrierea originala si sunt relevante pentru produs.',
    'Returneaza romana curata, text simplu, fara markdown, fara titluri de forma ### si fara bullet-uri decorative. Poti folosi subtitluri simple urmate de doua puncte doar daca ajuta structurarea.',
    `Tinteste o descriere foarte detaliata intre ${params.minChars} si ${params.maxChars} caractere. Daca descrierea originala este deja bogata, versiunea finala nu trebuie sa fie mai sumara decat ea.`,
    `Descriere originala (${params.sourceDescriptionLength} caractere):\n${params.sourceDescription || 'Nu exista descriere originala disponibila.'}`,
    `Specificatii normalizate:\n${params.specs}`,
  ].join('\n\n');
}
