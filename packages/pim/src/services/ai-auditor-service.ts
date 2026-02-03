import { AIAuditResponseSchema } from '../schemas/ai-audit.js';

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
}>;

export class AIAuditorService {
  async auditMatch(params: AIAuditParams): Promise<AIAuditResult> {
    const baseUrl = process.env['XAI_BASE_URL'] ?? 'https://api.x.ai/v1';
    const apiKey = process.env['XAI_API_KEY'];
    if (!apiKey) {
      throw new Error('XAI_API_KEY is not configured');
    }

    const model = process.env['XAI_MODEL'] ?? 'grok-4-1-fast-non-reasoning';
    const temperature = Number(process.env['XAI_TEMPERATURE'] ?? 0.1);
    const prompt = buildAuditPrompt(params);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Ești un auditor expert pentru match-uri de produse. Răspunde strict în JSON valid.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`xAI audit failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('xAI audit response missing content');
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
      modelUsed: model,
    };
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
