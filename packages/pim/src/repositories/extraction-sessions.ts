import { getDbPool } from '../db.js';

export type ProdExtractionSession = Readonly<{
  id: string;
  harvestId: string;
  agentVersion: string;
  modelName: string | null;
  extractedSpecs: Record<string, unknown>;
  groundingSnippets: Record<string, unknown> | null;
  confidenceScore: string | null;
  fieldConfidences: Record<string, unknown> | null;
  tokensUsed: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
  createdAt: string;
}>;

export type NewExtractionSession = Readonly<{
  harvestId: string;
  agentVersion: string;
  modelName?: string;
  extractedSpecs: Record<string, unknown>;
  groundingSnippets?: Record<string, unknown>;
  confidenceScore?: number;
  fieldConfidences?: Record<string, unknown>;
  tokensUsed?: number;
  latencyMs?: number;
  errorMessage?: string;
}>;

export async function createExtractionSession(
  data: NewExtractionSession
): Promise<ProdExtractionSession> {
  const pool = getDbPool();
  const result = await pool.query<ProdExtractionSession>(
    `INSERT INTO prod_extraction_sessions (
       harvest_id,
       agent_version,
       model_name,
       extracted_specs,
       grounding_snippets,
       confidence_score,
       field_confidences,
       tokens_used,
       latency_ms,
       error_message,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     RETURNING
       id,
       harvest_id as "harvestId",
       agent_version as "agentVersion",
       model_name as "modelName",
       extracted_specs as "extractedSpecs",
       grounding_snippets as "groundingSnippets",
       confidence_score as "confidenceScore",
       field_confidences as "fieldConfidences",
       tokens_used as "tokensUsed",
       latency_ms as "latencyMs",
       error_message as "errorMessage",
       created_at as "createdAt"`,
    [
      data.harvestId,
      data.agentVersion,
      data.modelName ?? null,
      JSON.stringify(data.extractedSpecs),
      data.groundingSnippets ? JSON.stringify(data.groundingSnippets) : null,
      data.confidenceScore ?? null,
      data.fieldConfidences ? JSON.stringify(data.fieldConfidences) : null,
      data.tokensUsed ?? null,
      data.latencyMs ?? null,
      data.errorMessage ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create prod_extraction_sessions row.');
  }
  return row;
}

export async function findExtractionSessionById(id: string): Promise<ProdExtractionSession | null> {
  const pool = getDbPool();
  const result = await pool.query<ProdExtractionSession>(
    `SELECT
       id,
       harvest_id as "harvestId",
       agent_version as "agentVersion",
       model_name as "modelName",
       extracted_specs as "extractedSpecs",
       grounding_snippets as "groundingSnippets",
       confidence_score as "confidenceScore",
       field_confidences as "fieldConfidences",
       tokens_used as "tokensUsed",
       latency_ms as "latencyMs",
       error_message as "errorMessage",
       created_at as "createdAt"
     FROM prod_extraction_sessions
    WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}
