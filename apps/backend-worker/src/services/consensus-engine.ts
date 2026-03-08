import { buildChatCompletionsUrl, type ChatModelCredentials } from '@app/pim';
import type { AppEnv } from '@app/config';
import type { Logger } from '@app/logger';
import {
  getAiRoutingRedis,
  recordConsensusCircuitBreakerFailure,
  recordConsensusCircuitBreakerSuccess,
  resolveChatTaskCredentials,
  resolveConsensusCredentials,
  type ChatTaskType,
  type ConsensusChatModelConfig,
} from './ai-provider-routing.js';
import { scanInput, scanOutput } from './guardrails.js';
import { recordConsensusCircuitBreakerTrip, recordConsensusMetrics } from '../otel/metrics.js';

type ChatMessage = Readonly<{
  role: 'system' | 'user' | 'assistant';
  content: string;
}>;

type ProgressStatus = 'done' | 'error';

type ConsensusMethod = 'unanimous' | 'majority' | 'arbitration' | 'single_fallback';

type ComparableValue = string | number | boolean | null;

interface ConsensusProgressEvent {
  step: string;
  message: string;
  status?: ProgressStatus;
}

interface ConsensusCallConfig<T> {
  shopId: string;
  env: AppEnv;
  logger: Logger;
  taskType: ChatTaskType;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: { type: 'json_object' | 'text' };
  maxTokens?: number;
  keyField?: string;
  parseResponse?: (value: string) => T;
  compareValue?: (value: T) => ComparableValue;
  onProgress?: (event: ConsensusProgressEvent) => void;
}

export interface ConsensusResult<T> {
  result: T;
  rawResponses: string[];
  method: ConsensusMethod;
  consensusScore: number;
  participantCount: number;
  arbitrationReasoning?: string;
  models: string[];
  durationMs: number;
}

interface ParsedParticipant<T> {
  parsed: T;
  raw: string;
  model: string;
  endpointId: string;
  provider: ChatModelCredentials['provider'];
}

interface ArbitrationEnvelope {
  selectedIndex: number | undefined;
  reasoning: string | undefined;
  consensusScore: number | undefined;
  finalResult: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    // ignore
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1];
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      // ignore
    }
  }

  const fallback = /\{[\s\S]*\}/.exec(trimmed)?.[0];
  if (!fallback) return null;
  try {
    const parsed = JSON.parse(fallback) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function getValueAtPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value;
  let cursor: unknown = value;
  for (const token of parsePath(path)) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      cursor = Number.isInteger(index) ? cursor[index] : undefined;
      continue;
    }
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[token];
  }
  return cursor;
}

function normalizeComparableValue(value: unknown): ComparableValue {
  if (typeof value === 'string') return normalizeForComparison(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function getComparableValue<T>(params: {
  parsed: T;
  keyField: string | undefined;
  compareValue: ((value: T) => ComparableValue) | undefined;
}): ComparableValue {
  if (params.compareValue) {
    return params.compareValue(params.parsed);
  }
  if (typeof params.parsed === 'string') {
    return normalizeForComparison(params.parsed);
  }
  return normalizeComparableValue(getValueAtPath(params.parsed, params.keyField));
}

export function areResponsesEquivalent<T>(params: {
  left: T;
  right: T;
  keyField: string | undefined;
  compareValue: ((value: T) => ComparableValue) | undefined;
}): boolean {
  return (
    getComparableValue({
      parsed: params.left,
      keyField: params.keyField,
      compareValue: params.compareValue,
    }) ===
    getComparableValue({
      parsed: params.right,
      keyField: params.keyField,
      compareValue: params.compareValue,
    })
  );
}

export function findMajority<T>(params: {
  responses: readonly ParsedParticipant<T>[];
  keyField: string | undefined;
  compareValue: ((value: T) => ComparableValue) | undefined;
}): { value: ParsedParticipant<T>; count: number } | null {
  const buckets = new Map<ComparableValue, { value: ParsedParticipant<T>; count: number }>();
  for (const response of params.responses) {
    const comparable = getComparableValue({
      parsed: response.parsed,
      keyField: params.keyField,
      compareValue: params.compareValue,
    });
    if (comparable == null) continue;
    const existing = buckets.get(comparable);
    if (existing) {
      existing.count += 1;
      continue;
    }
    buckets.set(comparable, { value: response, count: 1 });
  }

  const ranked = [...buckets.values()].sort((left, right) => right.count - left.count);
  return ranked[0] ?? null;
}

async function singleCallFallback<T>(params: ConsensusCallConfig<T>): Promise<ConsensusResult<T>> {
  const creds = await resolveChatTaskCredentials({
    shopId: params.shopId,
    taskType: params.taskType,
    env: params.env,
    logger: params.logger,
  });
  if (!creds) {
    throw new Error(`consensus_no_credentials:${params.taskType}`);
  }
  const startedAt = Date.now();
  const inputScan = await scanInput({
    shopId: params.shopId,
    text: params.userPrompt,
    env: params.env,
    logger: params.logger,
  });
  if (!inputScan.isValid) {
    throw new Error(`guardrails_blocked_consensus_input:${inputScan.reason ?? 'unknown'}`);
  }

  const raw = await singleModelFetch({
    config: {
      ...creds,
      endpointId: `${creds.provider}:${creds.model}`,
      timeoutMs: params.env.openAiTimeoutMs,
    },
    messages: [
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: inputScan.sanitizedText },
    ],
    responseFormat: params.responseFormat,
    maxTokens: params.maxTokens,
    env: params.env,
    logger: params.logger,
  });
  const outputScan = await scanOutput({
    shopId: params.shopId,
    prompt: inputScan.sanitizedText,
    output: raw,
    env: params.env,
    logger: params.logger,
  });
  if (!outputScan.isValid) {
    throw new Error(`guardrails_blocked_consensus_output:${outputScan.reason ?? 'unknown'}`);
  }
  const parser = params.parseResponse ?? ((value: string) => JSON.parse(value) as T);
  const result = parser(outputScan.sanitizedText);
  const durationMs = Date.now() - startedAt;
  recordConsensusMetrics({
    taskType: params.taskType,
    method: 'single_fallback',
    durationMs,
    score: 0.25,
    participants: 1,
    fallbackReason: 'consensus_disabled',
  });
  return {
    result,
    rawResponses: [outputScan.sanitizedText],
    method: 'single_fallback',
    consensusScore: 0.25,
    participantCount: 1,
    models: [creds.model],
    durationMs,
  };
}

function buildMessages(systemPrompt: string, userPrompt: string): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}

export function buildArbitrationPrompt(params: {
  taskType: ChatTaskType;
  systemPrompt: string;
  userPrompt: string;
  responses: readonly { index: number; model: string; content: string }[];
  responseFormat: { type: 'json_object' | 'text' } | undefined;
}): { systemPrompt: string; userPrompt: string } {
  const taskInstructions: Record<ChatTaskType, string> = {
    translation:
      'Evaluate translation accuracy for a Romanian home improvement / hardware / garden commerce context. Prefer exact domain terminology.',
    classification:
      'Evaluate which answer is the safest and most accurate classification. False positives are worse than low-confidence abstention.',
    extraction:
      'Evaluate factual completeness and accuracy. You may synthesize the best fields when the original response format is JSON.',
    audit:
      'Evaluate which audit decision best protects against false positives. Critical discrepancies must outweigh weak similarity signals.',
  };

  return {
    systemPrompt: [
      'You are an arbitration model that selects the best answer from multiple candidate responses.',
      taskInstructions[params.taskType],
      'Return STRICT JSON with keys: selectedIndex, consensusScore, reasoning, finalResult.',
      'selectedIndex must be 1-based and refer to the provided candidate responses.',
      params.responseFormat?.type === 'text'
        ? 'finalResult must be a string.'
        : 'finalResult must preserve the same JSON shape expected from the original task.',
    ].join('\n'),
    userPrompt: [
      `Original system prompt:\n${params.systemPrompt}`,
      `Original user prompt:\n${params.userPrompt}`,
      'Candidate responses:',
      ...params.responses.map(
        (response) => `${response.index}. [model=${response.model}]\n${response.content}`
      ),
    ].join('\n\n'),
  };
}

function parseArbitrationEnvelope(raw: string): ArbitrationEnvelope | null {
  const record = extractJsonObject(raw);
  if (!record) return null;
  return {
    selectedIndex:
      typeof record['selectedIndex'] === 'number' ? Math.trunc(record['selectedIndex']) : undefined,
    reasoning: typeof record['reasoning'] === 'string' ? record['reasoning'].trim() : undefined,
    consensusScore:
      typeof record['consensusScore'] === 'number' ? record['consensusScore'] : undefined,
    finalResult: record['finalResult'],
  };
}

function parseConsensusResult<T>(params: {
  raw: string;
  responseFormat: { type: 'json_object' | 'text' } | undefined;
  parseResponse: ((value: string) => T) | undefined;
}): T {
  if (params.parseResponse) {
    return params.parseResponse(params.raw);
  }
  if (params.responseFormat?.type === 'text') {
    return params.raw as T;
  }
  return JSON.parse(params.raw) as T;
}

function parseArbitrationFinalResult<T>(params: {
  envelope: ArbitrationEnvelope;
  responseFormat: { type: 'json_object' | 'text' } | undefined;
  parseResponse: ((value: string) => T) | undefined;
}): T | null {
  const { finalResult } = params.envelope;
  if (finalResult == null) return null;
  if (params.responseFormat?.type === 'text') {
    return typeof finalResult === 'string' ? (finalResult as T) : null;
  }
  if (!isRecord(finalResult)) return null;
  const raw = JSON.stringify(finalResult);
  try {
    return parseConsensusResult({
      raw,
      responseFormat: params.responseFormat,
      parseResponse: params.parseResponse,
    });
  } catch {
    return null;
  }
}

export async function singleModelFetch(params: {
  config: ConsensusChatModelConfig;
  messages: readonly ChatMessage[];
  responseFormat: { type: 'json_object' | 'text' } | undefined;
  maxTokens: number | undefined;
  env: AppEnv;
  logger: Logger;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.config.timeoutMs);
  try {
    const response = await fetch(buildChatCompletionsUrl(params.config.baseUrl), {
      method: 'POST',
      headers: {
        ...(params.config.apiKey ? { Authorization: `Bearer ${params.config.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.config.model,
        temperature: params.config.temperature,
        ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
        ...(params.responseFormat ? { response_format: params.responseFormat } : {}),
        messages: params.messages,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`consensus_model_error:${response.status}:${body}`);
    }
    const payload = (await response.json()) as {
      choices?: { message?: { content?: string | null } | null }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) {
      throw new Error('consensus_empty_content');
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export async function consensusChatCompletion<T>(
  params: ConsensusCallConfig<T>
): Promise<ConsensusResult<T>> {
  if (!params.env.consensusEnabled || params.env.consensusN <= 1) {
    return await singleCallFallback(params);
  }

  const startedAt = Date.now();
  const onProgress = params.onProgress;
  const inputScan = await scanInput({
    shopId: params.shopId,
    text: params.userPrompt,
    env: params.env,
    logger: params.logger,
  });
  if (!inputScan.isValid) {
    throw new Error(`guardrails_blocked_consensus_input:${inputScan.reason ?? 'unknown'}`);
  }

  const consensus = await resolveConsensusCredentials({
    shopId: params.shopId,
    taskType: params.taskType,
    env: params.env,
    logger: params.logger,
  });
  if (!consensus) {
    return await singleCallFallback(params);
  }

  const messages = buildMessages(params.systemPrompt, inputScan.sanitizedText);
  const calls = consensus.calls.slice(0, Math.max(1, params.env.consensusN));
  onProgress?.({
    step: 'consensus_start',
    message: `${calls.length} agenti evalueaza raspunsul...`,
  });

  const redis = getAiRoutingRedis(params.env);
  const settled = await Promise.allSettled(
    calls.map(async (config) => {
      try {
        const raw = await singleModelFetch({
          config,
          messages,
          responseFormat: params.responseFormat,
          maxTokens: params.maxTokens,
          env: params.env,
          logger: params.logger,
        });
        await recordConsensusCircuitBreakerSuccess({
          redis,
          redisPrefix: params.env.redisPrefix,
          endpointId: config.endpointId,
        });
        const outputScan = await scanOutput({
          shopId: params.shopId,
          prompt: inputScan.sanitizedText,
          output: raw,
          env: params.env,
          logger: params.logger,
        });
        if (!outputScan.isValid) {
          return null;
        }
        const parsed = parseConsensusResult({
          raw: outputScan.sanitizedText,
          responseFormat: params.responseFormat,
          parseResponse: params.parseResponse,
        });
        return {
          parsed,
          raw: outputScan.sanitizedText,
          model: config.model,
          endpointId: config.endpointId,
          provider: config.provider,
        } satisfies ParsedParticipant<T>;
      } catch (error) {
        const opened = await recordConsensusCircuitBreakerFailure({
          redis,
          redisPrefix: params.env.redisPrefix,
          endpointId: config.endpointId,
        });
        if (opened) {
          recordConsensusCircuitBreakerTrip(config.endpointId);
        }
        params.logger.warn(
          { shopId: params.shopId, endpointId: config.endpointId, error },
          'consensus_participant_failed'
        );
        return null;
      }
    })
  );

  const participants = settled.flatMap((result) => {
    if (result.status !== 'fulfilled' || !result.value) return [];
    return [result.value];
  });

  if (participants.length === 0) {
    const fallback = await singleCallFallback(params);
    recordConsensusMetrics({
      taskType: params.taskType,
      method: fallback.method,
      durationMs: fallback.durationMs,
      score: fallback.consensusScore,
      participants: fallback.participantCount,
      fallbackReason: 'all_participants_failed',
    });
    return fallback;
  }

  if (participants.length === 1) {
    const durationMs = Date.now() - startedAt;
    recordConsensusMetrics({
      taskType: params.taskType,
      method: 'single_fallback',
      durationMs,
      score: 0.25,
      participants: 1,
      fallbackReason: 'single_valid_response',
    });
    return {
      result: participants[0]!.parsed,
      rawResponses: participants.map((participant) => participant.raw),
      method: 'single_fallback',
      consensusScore: 0.25,
      participantCount: 1,
      models: participants.map((participant) => participant.model),
      durationMs,
    };
  }

  const majority = findMajority({
    responses: participants,
    keyField: params.keyField,
    compareValue: params.compareValue,
  });
  const threshold =
    participants.length === 3
      ? 2
      : participants.length === 2
        ? 2
        : Math.ceil(participants.length * params.env.consensusSkipThreshold);
  if (majority && majority.count >= threshold) {
    const durationMs = Date.now() - startedAt;
    const method: ConsensusMethod =
      majority.count === participants.length ? 'unanimous' : 'majority';
    const score = majority.count / participants.length;
    onProgress?.({
      step: 'consensus_majority',
      message: `Consens: ${majority.count}/${participants.length} identice`,
      status: 'done',
    });
    recordConsensusMetrics({
      taskType: params.taskType,
      method,
      durationMs,
      score,
      participants: participants.length,
    });
    return {
      result: majority.value.parsed,
      rawResponses: participants.map((participant) => participant.raw),
      method,
      consensusScore: score,
      participantCount: participants.length,
      models: participants.map((participant) => participant.model),
      durationMs,
    };
  }

  onProgress?.({
    step: 'consensus_arbitration',
    message: 'Arbitrare deep reasoning...',
  });
  const arbitrationPrompt = buildArbitrationPrompt({
    taskType: params.taskType,
    systemPrompt: params.systemPrompt,
    userPrompt: inputScan.sanitizedText,
    responses: participants.map((participant, index) => ({
      index: index + 1,
      model: participant.model,
      content: participant.raw,
    })),
    responseFormat: params.responseFormat,
  });
  const arbitrationRaw = await singleModelFetch({
    config: consensus.arbitration,
    messages: buildMessages(arbitrationPrompt.systemPrompt, arbitrationPrompt.userPrompt),
    responseFormat: { type: 'json_object' },
    maxTokens: Math.max(params.maxTokens ?? 600, 600),
    env: params.env,
    logger: params.logger,
  });
  const arbitrationScan = await scanOutput({
    shopId: params.shopId,
    prompt: arbitrationPrompt.userPrompt,
    output: arbitrationRaw,
    env: params.env,
    logger: params.logger,
  });
  if (!arbitrationScan.isValid) {
    throw new Error(
      `guardrails_blocked_consensus_arbitration:${arbitrationScan.reason ?? 'unknown'}`
    );
  }
  const envelope = parseArbitrationEnvelope(arbitrationScan.sanitizedText);
  const selectedParticipant =
    envelope?.selectedIndex &&
    envelope.selectedIndex >= 1 &&
    envelope.selectedIndex <= participants.length
      ? participants[envelope.selectedIndex - 1]!
      : participants[0]!;
  const arbitrationResult =
    (envelope
      ? parseArbitrationFinalResult({
          envelope,
          responseFormat: params.responseFormat,
          parseResponse: params.parseResponse,
        })
      : null) ?? selectedParticipant.parsed;
  const durationMs = Date.now() - startedAt;
  const score = Math.max(
    0,
    Math.min(1, envelope?.consensusScore ?? Math.max(0.5, 1 / participants.length))
  );
  onProgress?.({
    step: 'consensus_result',
    message: `Consens final score ${score.toFixed(2)}`,
    status: 'done',
  });
  recordConsensusMetrics({
    taskType: params.taskType,
    method: 'arbitration',
    durationMs,
    score,
    participants: participants.length,
    arbitrationNeeded: true,
  });
  return {
    result: arbitrationResult,
    rawResponses: participants.map((participant) => participant.raw),
    method: 'arbitration',
    consensusScore: score,
    participantCount: participants.length,
    ...(envelope?.reasoning ? { arbitrationReasoning: envelope.reasoning } : {}),
    models: [...participants.map((participant) => participant.model), consensus.arbitration.model],
    durationMs,
  };
}
