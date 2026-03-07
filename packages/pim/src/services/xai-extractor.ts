import { ExtractedProductSchema, type ExtractedProduct } from '../schemas/product-extraction.js';
import { normalizeGTIN, validateGTINChecksum } from '../utils/gtin-validator.js';
import type { HTMLContentProvider } from './html-content-provider.js';
import { acquireProviderRateLimit } from './rate-limiter.js';
import { trackCost } from './cost-tracker.js';
import { enforceBudget } from './budget-guard.js';
import {
  buildChatCompletionsUrl,
  estimateChatCost,
  type ChatModelCredentials,
} from './llm-credentials.js';

export const XAI_EXTRACTOR_AGENT_VERSION = 'xai-extractor-v1.0';
export const XAI_CONFIDENCE_THRESHOLD = 0.8;

export type ExtractionParams = Readonly<{
  html: string;
  sourceUrl: string;
  shopId: string;
  credentials: ChatModelCredentials;
  matchId?: string;
  productId?: string;
}>;

export type ExtractionResult = Readonly<{
  success: boolean;
  data?: ExtractedProduct;
  tokensUsed: { input: number; output: number };
  latencyMs: number;
  error?: string;
  gtinValidation?: {
    original: string | undefined;
    normalized: string | null;
    valid: boolean;
  };
}>;

interface LLMExtractionResponse {
  httpStatus: number;
  tokensInput: number;
  tokensOutput: number;
  parsed: ExtractedProduct;
}

interface TrackExtractionCostParams {
  credentials: ChatModelCredentials;
  shopId: string;
  tokensInput: number;
  tokensOutput: number;
  httpStatus: number;
  latencyMs: number;
  productId?: string | undefined;
  matchId?: string | undefined;
  errorMessage?: string | undefined;
}

async function callLLMExtraction(
  credentials: ChatModelCredentials,
  sourceUrl: string,
  html: string
): Promise<LLMExtractionResponse> {
  const truncatedHtml = html.slice(0, 50000);
  const response = await fetch(buildChatCompletionsUrl(credentials.baseUrl), {
    method: 'POST',
    headers: {
      ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: credentials.model,
      temperature: credentials.temperature,
      max_tokens: credentials.maxTokensPerRequest,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Esti un expert in extractia structurata a datelor despre produse din pagini web.\n' +
            'REGULI STRICTE:\n' +
            '- Extrage DOAR informatii care apar explicit in HTML\n' +
            '- NU inventa sau presupune valori\n' +
            '- Daca un camp nu exista, lasa-l undefined\n' +
            '- Pentru GTIN/EAN/UPC verifica 8-14 cifre\n' +
            '- Extrage descrierea completa a produsului in campul description\n' +
            '- Descrierea trebuie sa fie in romana si sa aiba minimum 100 cuvinte\n' +
            '- Daca nu exista descriere clara, lasa description undefined\n' +
            '- Confidence < 0.8 daca informatiile sunt ambigue\n' +
            '- Adauga in fieldsUncertain toate campurile nesigure',
        },
        {
          role: 'user',
          content: `Extrage informatiile despre produs din acest HTML.\n\nURL sursa: ${sourceUrl}\n\nHTML:\n${truncatedHtml}`,
        },
      ],
    }),
  });

  const httpStatus = response.status;
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const tokensInput = data.usage?.prompt_tokens ?? 0;
  const tokensOutput = data.usage?.completion_tokens ?? 0;

  if (!response.ok) {
    throw new Error(
      `${credentials.provider} extraction failed: ${response.status} ${response.statusText}`
    );
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${credentials.provider} response missing content`);
  }

  const parsed = ExtractedProductSchema.parse(safeJsonParse(content));

  return { httpStatus, tokensInput, tokensOutput, parsed };
}

function applyGtinValidation(
  parsed: ExtractedProduct
): ExtractionResult['gtinValidation'] | undefined {
  if (!parsed.gtin) return undefined;

  const normalized = normalizeGTIN(parsed.gtin);
  const valid = validateGTINChecksum(parsed.gtin);

  if (!valid) {
    parsed.confidence.fieldsUncertain.push('gtin');
    if (parsed.confidence.overall > 0.7) {
      parsed.confidence.overall = 0.7;
    }
  }

  return { original: parsed.gtin, normalized, valid };
}

async function trackExtractionCost(params: TrackExtractionCostParams): Promise<void> {
  await trackCost({
    provider: params.credentials.provider,
    operation: 'extraction',
    endpoint: 'extract-product',
    shopId: params.shopId,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
    estimatedCost: estimateChatCost({
      provider: params.credentials.provider,
      tokensInput: params.tokensInput,
      tokensOutput: params.tokensOutput,
    }),
    httpStatus: params.httpStatus,
    responseTimeMs: params.latencyMs,
    ...(params.productId ? { productId: params.productId } : {}),
    metadata: {
      ...(params.matchId ? { matchId: params.matchId } : {}),
    },
    ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
  });
}

export class XaiExtractorService {
  async extractProductFromHTML(params: ExtractionParams): Promise<ExtractionResult> {
    const { html, sourceUrl, shopId, credentials, matchId, productId } = params;
    try {
      await enforceBudget({ provider: credentials.provider, shopId });
    } catch (error) {
      return {
        success: false,
        tokensUsed: { input: 0, output: 0 },
        latencyMs: 0,
        error:
          error instanceof Error ? error.message : `Daily ${credentials.provider} budget exceeded`,
      };
    }

    await acquireProviderRateLimit({
      provider: credentials.provider,
      shopId,
      rateLimitPerMinute: credentials.rateLimitPerMinute,
    });

    const startTime = Date.now();
    let tokensInput = 0;
    let tokensOutput = 0;
    let httpStatus = 0;

    try {
      const llmResult = await callLLMExtraction(credentials, sourceUrl, html);
      httpStatus = llmResult.httpStatus;
      tokensInput = llmResult.tokensInput;
      tokensOutput = llmResult.tokensOutput;
      const latencyMs = Date.now() - startTime;

      const gtinValidation = applyGtinValidation(llmResult.parsed);

      await trackExtractionCost({
        credentials,
        shopId,
        tokensInput,
        tokensOutput,
        httpStatus,
        latencyMs,
        productId,
        matchId,
      });

      if (llmResult.parsed.confidence.overall < XAI_CONFIDENCE_THRESHOLD) {
        return {
          success: false,
          data: llmResult.parsed,
          tokensUsed: { input: tokensInput, output: tokensOutput },
          latencyMs,
          ...(gtinValidation ? { gtinValidation } : {}),
          error: `Confidence ${llmResult.parsed.confidence.overall} below threshold ${XAI_CONFIDENCE_THRESHOLD}`,
        };
      }

      return {
        success: true,
        data: llmResult.parsed,
        tokensUsed: { input: tokensInput, output: tokensOutput },
        latencyMs,
        ...(gtinValidation ? { gtinValidation } : {}),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown extraction error';

      await trackExtractionCost({
        credentials,
        shopId,
        tokensInput,
        tokensOutput,
        httpStatus,
        latencyMs,
        productId,
        matchId,
        errorMessage,
      });

      return {
        success: false,
        tokensUsed: { input: tokensInput, output: tokensOutput },
        latencyMs,
        error: errorMessage,
      };
    }
  }

  async extractProductFromURL(params: {
    url: string;
    shopId: string;
    credentials: ChatModelCredentials;
    contentProvider: HTMLContentProvider;
    matchId?: string;
    productId?: string;
  }): Promise<ExtractionResult> {
    const result = await params.contentProvider.fetchHTML(params.url);
    if (result.error || !result.html) {
      return {
        success: false,
        tokensUsed: { input: 0, output: 0 },
        latencyMs: 0,
        error: result.error ?? 'Failed to fetch HTML',
      };
    }

    return this.extractProductFromHTML({
      html: result.html,
      sourceUrl: params.url,
      shopId: params.shopId,
      credentials: params.credentials,
      ...(params.matchId ? { matchId: params.matchId } : {}),
      ...(params.productId ? { productId: params.productId } : {}),
    });
  }
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid JSON payload', {
      cause: error,
    });
  }
}
