import { jest } from '@jest/globals';
import '../../src/common/globals.js';
import { complete, resolveModel, setGenAiClient } from '../../src/modules/ai/providers/llm.provider.js';

describe('Unit — AI LLM Provider Seam (llm.provider.js)', () => {
  let mockGenerateContent;

  beforeEach(() => {
    mockGenerateContent = jest.fn();
    setGenAiClient({
      models: {
        generateContent: mockGenerateContent,
      },
    });
  });

  afterEach(() => {
    setGenAiClient(null);
    jest.clearAllMocks();
  });

  it('resolves the correct model ID defaulting to gemini-3.1-flash-lite', () => {
    expect(resolveModel('reasoning')).toBe('gemini-3.1-flash-lite');
    expect(resolveModel('vision')).toBe('gemini-3.1-flash-lite');
  });

  it('successfully generates structured content and returns data, usage, and latency', async () => {
    const mockOutput = { inDomain: true, language: 'en' };
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(mockOutput),
      usageMetadata: {
        promptTokenCount: 42,
        candidatesTokenCount: 15,
      },
    });

    const result = await complete({
      task: 'reasoning',
      systemPrompt: 'You are an AI stylist.',
      userParts: [{ text: 'I need a suit for a wedding' }],
      responseSchema: { type: 'OBJECT' },
      temperature: 0.1,
    });

    expect(result).toBeDefined();
    expect(result.data).toEqual(mockOutput);
    expect(result.usage).toEqual({
      inputTokens: 42,
      outputTokens: 15,
    });
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.model).toBe('gemini-3.1-flash-lite');
    expect(callArg.config.systemInstruction).toBe('You are an AI stylist.');
    expect(callArg.config.responseMimeType).toBe('application/json');
    expect(callArg.config.responseSchema).toEqual({ type: 'OBJECT' });
    expect(callArg.contents[0].parts).toEqual([{ text: 'I need a suit for a wedding' }]);
  });

  it('accepts string userParts and normalizes to parts array', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ ok: true }),
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });

    const result = await complete({
      userParts: 'Hello world',
    });

    expect(result.data).toEqual({ ok: true });
    const callArg = mockGenerateContent.mock.calls[0][0];
    expect(callArg.contents[0].parts).toEqual([{ text: 'Hello world' }]);
  });

  it('retries once on transient failure (e.g. 503) and succeeds on second attempt', async () => {
    const transientErr = new Error('Service Unavailable');
    transientErr.status = 503;

    mockGenerateContent
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce({
        text: JSON.stringify({ successAfterRetry: true }),
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      });

    const result = await complete({
      userParts: [{ text: 'retry test' }],
    });

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ successAfterRetry: true });
  });

  it('retries once on resource exhausted error and throws ApiError(502) if retry also fails', async () => {
    const transientErr = new Error('RESOURCE_EXHAUSTED: quota exceeded temporarily');
    mockGenerateContent
      .mockRejectedValueOnce(transientErr)
      .mockRejectedValueOnce(transientErr);

    await expect(
      complete({
        userParts: [{ text: 'exhausted test' }],
      })
    ).rejects.toThrow(ApiError);

    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('fails closed immediately without retrying on non-transient error (e.g. 400 Bad Request)', async () => {
    const permanentErr = new Error('Invalid argument: invalid schema definition');
    permanentErr.status = 400;

    mockGenerateContent.mockRejectedValueOnce(permanentErr);

    await expect(
      complete({
        userParts: [{ text: 'permanent error' }],
      })
    ).rejects.toThrow(ApiError);

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('fails closed with 504 on timeout when provider hangs past timeoutMs', async () => {
    mockGenerateContent.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 500))
    );

    let caughtError;
    try {
      await complete({
        userParts: [{ text: 'timeout test' }],
        timeoutMs: 50,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    expect(caughtError).toBeInstanceOf(ApiError);
    expect(caughtError.statusCode).toBe(504);
    expect(caughtError.message).toContain('timed out');
  });

  it('throws ApiError(502) when provider returns malformed JSON', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '<<< INVALID NOT JSON >>>',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
    });

    await expect(
      complete({
        userParts: [{ text: 'malformed json test' }],
      })
    ).rejects.toThrow(ApiError);
  });

  it('throws ApiError(502) when provider returns empty response', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '',
      usageMetadata: {},
    });

    await expect(
      complete({
        userParts: [{ text: 'empty test' }],
      })
    ).rejects.toThrow(ApiError);
  });
});
