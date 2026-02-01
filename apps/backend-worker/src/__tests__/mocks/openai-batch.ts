import nock from 'nock';

export interface MockBatchConfig {
  batchId?: string;
  inputFileId?: string;
  outputFileId?: string;
  embedding?: number[];
  status?: 'completed' | 'failed' | 'in_progress';
}

export function mockOpenAiBatchFlow(config: MockBatchConfig = {}): {
  batchId: string;
  inputFileId: string;
  outputFileId: string;
} {
  const batchId = config.batchId ?? 'batch_mock_123';
  const inputFileId = config.inputFileId ?? 'file-input-mock';
  const outputFileId = config.outputFileId ?? 'file-output-mock';
  const embedding = config.embedding ?? Array(2000).fill(0.1);
  const status = config.status ?? 'completed';

  nock('https://api.openai.com')
    .post('/v1/files')
    .reply(200, { id: inputFileId, purpose: 'batch' });

  nock('https://api.openai.com')
    .post('/v1/batches')
    .reply(200, {
      id: batchId,
      status,
      input_file_id: inputFileId,
      output_file_id: status === 'completed' ? outputFileId : null,
    });

  nock('https://api.openai.com').get(`/v1/batches/${batchId}`).reply(200, {
    id: batchId,
    status: 'completed',
    output_file_id: outputFileId,
  });

  const outputContent = JSON.stringify({
    custom_id: 'prod-1|combined|hash123',
    response: {
      status_code: 200,
      body: { data: [{ embedding }], usage: { total_tokens: 50 } },
    },
  });

  nock('https://api.openai.com').get(`/v1/files/${outputFileId}/content`).reply(200, outputContent);

  return { batchId, inputFileId, outputFileId };
}

export function cleanOpenAiMocks(): void {
  nock.cleanAll();
}
