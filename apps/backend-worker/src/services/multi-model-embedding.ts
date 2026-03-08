import { createEmbeddingsProvider, type EmbeddingsProvider } from '@app/ai-engine';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import { recordEmbeddingMultiModelCandidatesAdded } from '../otel/metrics.js';
import { getShopOpenAiConfig } from '../runtime/openai-config.js';
import { resolveEmbeddingsProvider } from './ai-provider-routing.js';

export interface DualEmbeddingsResult {
  primaryEmbedding: readonly number[];
  primaryModel: string;
  secondaryEmbedding: readonly number[] | null;
  secondaryModel: string | null;
}

export interface DualEmbeddingsBatchResult {
  primaryEmbeddings: readonly (readonly number[])[];
  primaryModel: string;
  secondaryEmbeddings: readonly (readonly number[])[];
  secondaryModel: string | null;
}

export async function resolveSecondaryEmbeddingsProvider(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
}): Promise<EmbeddingsProvider | null> {
  if (!params.env.consensusEmbeddingSecondaryEnabled) {
    return null;
  }

  const config = await getShopOpenAiConfig({
    shopId: params.shopId,
    env: params.env,
    logger: params.logger,
  });
  if (!config.enabled || !config.openAiApiKey) {
    return null;
  }

  const provider = createEmbeddingsProvider({
    openAiApiKey: config.openAiApiKey,
    ...(config.openAiBaseUrl ? { openAiBaseUrl: config.openAiBaseUrl } : {}),
    openAiEmbeddingsModel: config.openAiEmbeddingsModel,
    openAiTimeoutMs: params.env.openAiTimeoutMs,
  });
  return provider.isAvailable() ? provider : null;
}

export async function resolveDualEmbeddingsProviders(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
}): Promise<{ primary: EmbeddingsProvider; secondary: EmbeddingsProvider | null }> {
  const primary = await resolveEmbeddingsProvider(params);
  const secondary =
    primary.kind === 'selfhosted' ? await resolveSecondaryEmbeddingsProvider(params) : null;
  return { primary, secondary };
}

export async function generateDualEmbeddings(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  text: string;
  primary?: EmbeddingsProvider;
  secondary?: EmbeddingsProvider | null;
}): Promise<DualEmbeddingsResult> {
  const resolvedProviders =
    params.primary && params.secondary !== undefined
      ? { primary: params.primary, secondary: params.secondary }
      : await resolveDualEmbeddingsProviders({
          shopId: params.shopId,
          env: params.env,
          logger: params.logger,
        });

  const [primaryEmbedding] = await resolvedProviders.primary.embedTexts([params.text]);
  if (primaryEmbedding?.length !== resolvedProviders.primary.model.dimensions) {
    throw new Error('dual_embedding_primary_failed');
  }

  let secondaryEmbedding: readonly number[] | null = null;
  let secondaryModel: string | null = null;
  if (resolvedProviders.secondary?.isAvailable()) {
    try {
      const [candidate] = await resolvedProviders.secondary.embedTexts([params.text]);
      if (candidate?.length === resolvedProviders.secondary.model.dimensions) {
        secondaryEmbedding = candidate;
        secondaryModel = resolvedProviders.secondary.model.name;
      }
    } catch (error) {
      params.logger.warn({ shopId: params.shopId, error }, 'dual_embedding_secondary_failed');
    }
  }

  return {
    primaryEmbedding,
    primaryModel: resolvedProviders.primary.model.name,
    secondaryEmbedding,
    secondaryModel,
  };
}

export async function generateDualEmbeddingsBatch(params: {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  texts: readonly string[];
  primary?: EmbeddingsProvider;
  secondary?: EmbeddingsProvider | null;
}): Promise<DualEmbeddingsBatchResult> {
  const resolvedProviders =
    params.primary && params.secondary !== undefined
      ? { primary: params.primary, secondary: params.secondary }
      : await resolveDualEmbeddingsProviders({
          shopId: params.shopId,
          env: params.env,
          logger: params.logger,
        });

  const primaryEmbeddings = await resolvedProviders.primary.embedTexts([...params.texts]);
  if (primaryEmbeddings.length !== params.texts.length) {
    throw new Error('dual_embedding_primary_batch_size_mismatch');
  }
  if (
    primaryEmbeddings.some(
      (embedding) => embedding?.length !== resolvedProviders.primary.model.dimensions
    )
  ) {
    throw new Error('dual_embedding_primary_batch_failed');
  }

  let secondaryEmbeddings: readonly (readonly number[])[] = [];
  let secondaryModel: string | null = null;

  if (resolvedProviders.secondary?.isAvailable()) {
    try {
      const candidate = await resolvedProviders.secondary.embedTexts([...params.texts]);
      if (
        candidate.length === params.texts.length &&
        candidate.every(
          (embedding) => embedding?.length === resolvedProviders.secondary?.model.dimensions
        )
      ) {
        secondaryEmbeddings = candidate;
        secondaryModel = resolvedProviders.secondary.model.name;
      }
    } catch (error) {
      params.logger.warn({ shopId: params.shopId, error }, 'dual_embedding_secondary_batch_failed');
    }
  }

  return {
    primaryEmbeddings,
    primaryModel: resolvedProviders.primary.model.name,
    secondaryEmbeddings,
    secondaryModel,
  };
}

export function mergeMultiModelCandidates<T extends { id: string; similarity: number }>(
  primary: readonly T[],
  secondary: readonly T[],
  table: string
): T[] {
  const merged = new Map<string, T>();
  for (const candidate of [...primary, ...secondary]) {
    const existing = merged.get(candidate.id);
    if (!existing || candidate.similarity > existing.similarity) {
      merged.set(candidate.id, candidate);
    }
  }
  const secondaryOnlyCount = secondary.filter(
    (candidate) => !primary.some((item) => item.id === candidate.id)
  ).length;
  recordEmbeddingMultiModelCandidatesAdded(secondaryOnlyCount, table);
  return [...merged.values()].sort((left, right) => right.similarity - left.similarity);
}
