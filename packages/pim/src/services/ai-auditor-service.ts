import { AIAuditResponseSchema } from '../schemas/ai-audit.js';
import { acquireProviderRateLimit } from './rate-limiter.js';
import { trackCost } from './cost-tracker.js';
import { enforceBudget } from './budget-guard.js';
import {
  buildChatCompletionsUrl,
  estimateChatCost,
  type ChatApiProvider,
  type ChatModelCredentials,
} from './llm-credentials.js';

export type AIAuditDecision = 'approve' | 'reject' | 'escalate_to_human';

export type AIAuditResult = Readonly<{
  decision: AIAuditDecision;
  confidence: number;
  reasoning: string;
  criticalDiscrepancies: string[];
  usableForEnrichment: boolean;
  isSameProduct: 'yes' | 'no' | 'uncertain';
  auditedAt: string;
  modelUsed: string;
}>;

export type AIAuditParams = Readonly<{
  shopId: string;
  credentials: ChatModelCredentials;
  localProduct: {
    title: string;
    brand?: string | null;
    gtin?: string | null;
    mpn?: string | null;
    category?: string | null;
  };
  match: {
    similarityScore: number;
    sourceUrl: string;
    sourceTitle?: string | null;
    sourceBrand?: string | null;
    sourceGtin?: string | null;
    sourcePrice?: string | number | null;
    sourceCurrency?: string | null;
  };
  completionRunner?: AIAuditCompletionRunner;
}>;

export interface AIAuditCompletionRunnerParams {
  credentials: ChatModelCredentials;
  systemPrompt: string;
  userPrompt: string;
}

export interface AIAuditCompletionRunnerResult {
  content: string;
  httpStatus?: number;
  tokensInput?: number;
  tokensOutput?: number;
  modelUsed?: string;
  providerUsed?: ChatApiProvider;
}

export type AIAuditCompletionRunner = (
  params: AIAuditCompletionRunnerParams
) => Promise<AIAuditCompletionRunnerResult>;

export class AIAuditorService {
  async auditMatch(params: AIAuditParams): Promise<AIAuditResult> {
    await enforceBudget({ provider: params.credentials.provider, shopId: params.shopId });

    await acquireProviderRateLimit({
      provider: params.credentials.provider,
      shopId: params.shopId,
      rateLimitPerMinute: params.credentials.rateLimitPerMinute,
    });

    const prompt = buildAuditPrompt(params);
    const systemPrompt =
      'Esti un auditor expert pentru match-uri de produse. Raspunde strict in JSON valid.';
    const startTime = Date.now();
    let httpStatus = 0;
    let tokensInput = 0;
    let tokensOutput = 0;

    try {
      const data: AIAuditCompletionRunnerResult = params.completionRunner
        ? await params.completionRunner({
            credentials: params.credentials,
            systemPrompt,
            userPrompt: prompt,
          })
        : await (async () => {
            const response = await fetch(buildChatCompletionsUrl(params.credentials.baseUrl), {
              method: 'POST',
              headers: {
                ...(params.credentials.apiKey
                  ? { Authorization: `Bearer ${params.credentials.apiKey}` }
                  : {}),
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: params.credentials.model,
                temperature: params.credentials.temperature,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: prompt },
                ],
              }),
            });
            const payload = (await response.json()) as {
              choices?: { message?: { content?: string } }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            return {
              content: payload.choices?.[0]?.message?.content ?? '',
              httpStatus: response.status,
              tokensInput: payload.usage?.prompt_tokens ?? 0,
              tokensOutput: payload.usage?.completion_tokens ?? 0,
              modelUsed: params.credentials.model,
              providerUsed: params.credentials.provider,
            };
          })();
      httpStatus = data.httpStatus ?? 200;
      tokensInput = data.tokensInput ?? 0;
      tokensOutput = data.tokensOutput ?? 0;

      await trackCost({
        provider: params.credentials.provider,
        operation: 'audit',
        endpoint: 'ai-audit',
        shopId: params.shopId,
        tokensInput,
        tokensOutput,
        estimatedCost: estimateChatCost({
          provider: params.credentials.provider,
          tokensInput,
          tokensOutput,
        }),
        httpStatus,
        responseTimeMs: Date.now() - startTime,
      });

      if (httpStatus >= 400) {
        throw new Error(`${params.credentials.provider} audit failed: ${String(httpStatus)}`);
      }

      const content = data.content;
      if (!content) {
        throw new Error(`${params.credentials.provider} audit response missing content`);
      }

      const parsed = AIAuditResponseSchema.parse(JSON.parse(content));
      const nowIso = new Date().toISOString();

      return {
        decision: parsed.recommendation,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        criticalDiscrepancies: parsed.criticalDiscrepancies,
        usableForEnrichment: parsed.usableForEnrichment !== 'no',
        isSameProduct: parsed.isSameProduct,
        auditedAt: nowIso,
        modelUsed: data.modelUsed ?? params.credentials.model,
      };
    } catch (error) {
      await trackCost({
        provider: params.credentials.provider,
        operation: 'audit',
        endpoint: 'ai-audit',
        shopId: params.shopId,
        tokensInput,
        tokensOutput,
        estimatedCost: estimateChatCost({
          provider: params.credentials.provider,
          tokensInput,
          tokensOutput,
        }),
        httpStatus,
        responseTimeMs: Date.now() - startTime,
        errorMessage: error instanceof Error ? error.message : 'Unknown audit error',
      });
      throw error;
    }
  }
}

function buildAuditPrompt(params: AIAuditParams): string {
  return `Ești un auditor expert pentru date de produse.

Analizează critic următorul match extern pentru produsul nostru:

PRODUS LOCAL:
- Titlu: ${params.localProduct.title}
- Brand: ${params.localProduct.brand ?? 'N/A'}
- GTIN: ${params.localProduct.gtin ?? 'N/A'}
- MPN: ${params.localProduct.mpn ?? 'N/A'}
- Categorie: ${params.localProduct.category ?? 'N/A'}

MATCH EXTERN (similarity: ${params.match.similarityScore}):
- URL: ${params.match.sourceUrl}
- Titlu: ${params.match.sourceTitle ?? 'N/A'}
- Brand: ${params.match.sourceBrand ?? 'N/A'}
- GTIN: ${params.match.sourceGtin ?? 'N/A'}
- Preț: ${params.match.sourcePrice ?? 'N/A'} ${params.match.sourceCurrency ?? ''}

ÎNTREBĂRI DE VALIDARE:
1. Este același produs fizic? (yes/no/uncertain)
2. Datele externe sunt folosibile pentru enrichment? (yes/no/partial)
3. Există discrepanțe critice? (listă)
4. Recomandare: (approve/reject/escalate_to_human)
5. Confidence în decizie: (0.0-1.0)
6. Motivare: (explicație scurtă)

Răspunde DOAR în format JSON cu următoarele chei:
{
  "isSameProduct": "yes|no|uncertain",
  "usableForEnrichment": "yes|no|partial",
  "criticalDiscrepancies": ["..."],
  "recommendation": "approve|reject|escalate_to_human",
  "confidence": 0.0,
  "reasoning": "text scurt"
}`;
}
