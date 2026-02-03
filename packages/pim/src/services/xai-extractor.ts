import { ExtractedProductSchema, type ExtractedProduct } from '../schemas/product-extraction.js';
import { normalizeGTIN, validateGTINChecksum } from '../utils/gtin-validator.js';
import type { HTMLContentProvider } from './html-content-provider.js';
import type { XAICredentials } from './xai-credentials.js';
import { acquireXaiRateLimit } from './xai-rate-limiter.js';
import { checkXaiDailyBudget, trackXaiCost } from './xai-cost-tracker.js';

export const XAI_EXTRACTOR_AGENT_VERSION = 'xai-extractor-v1.0';
export const XAI_CONFIDENCE_THRESHOLD = 0.8;

export type ExtractionParams = Readonly<{
  html: string;
  sourceUrl: string;
  shopId: string;
  credentials: XAICredentials;
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

export class XaiExtractorService {
  async extractProductFromHTML(params: ExtractionParams): Promise<ExtractionResult> {
    const { html, sourceUrl, shopId, credentials, matchId, productId } = params;
    const budget = await checkXaiDailyBudget(shopId);
    if (budget.exceeded) {
      return {
        success: false,
        tokensUsed: { input: 0, output: 0 },
        latencyMs: 0,
        error: 'Daily xAI budget exceeded',
      };
    }

    await acquireXaiRateLimit({
      shopId,
      rateLimitPerMinute: credentials.rateLimitPerMinute,
    });

    const startTime = Date.now();
    let tokensInput = 0;
    let tokensOutput = 0;
    let httpStatus = 0;

    try {
      const truncatedHtml = html.slice(0, 50000);
      const response = await fetch(`${credentials.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
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

      httpStatus = response.status;
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      tokensInput = data.usage?.prompt_tokens ?? 0;
      tokensOutput = data.usage?.completion_tokens ?? 0;
      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`xAI extraction failed: ${response.status} ${response.statusText}`);
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('xAI response missing content');
      }

      const parsed = ExtractedProductSchema.parse(safeJsonParse(content));

      let gtinValidation: ExtractionResult['gtinValidation'];
      if (parsed.gtin) {
        const normalized = normalizeGTIN(parsed.gtin);
        const valid = validateGTINChecksum(parsed.gtin);
        gtinValidation = { original: parsed.gtin, normalized, valid };

        if (!valid) {
          parsed.confidence.fieldsUncertain.push('gtin');
          if (parsed.confidence.overall > 0.7) {
            parsed.confidence.overall = 0.7;
          }
        }
      }

      await trackXaiCost({
        shopId,
        endpoint: 'extract-product',
        tokensInput,
        tokensOutput,
        httpStatus,
        responseTimeMs: latencyMs,
        ...(productId ? { productId } : {}),
        ...(matchId ? { matchId } : {}),
      });

      if (parsed.confidence.overall < XAI_CONFIDENCE_THRESHOLD) {
        return {
          success: false,
          data: parsed,
          tokensUsed: { input: tokensInput, output: tokensOutput },
          latencyMs,
          ...(gtinValidation ? { gtinValidation } : {}),
          error: `Confidence ${parsed.confidence.overall} below threshold ${XAI_CONFIDENCE_THRESHOLD}`,
        };
      }

      return {
        success: true,
        data: parsed,
        tokensUsed: { input: tokensInput, output: tokensOutput },
        latencyMs,
        ...(gtinValidation ? { gtinValidation } : {}),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown extraction error';

      await trackXaiCost({
        shopId,
        endpoint: 'extract-product',
        tokensInput,
        tokensOutput,
        httpStatus,
        responseTimeMs: latencyMs,
        ...(productId ? { productId } : {}),
        ...(matchId ? { matchId } : {}),
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
    credentials: XAICredentials;
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
    throw new Error(error instanceof Error ? error.message : 'Invalid JSON payload');
  }
}
