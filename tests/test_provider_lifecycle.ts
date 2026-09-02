/**
 * Regression coverage for the provider attempt lifecycle (T23.10).
 *
 * The OpenAI client is replaced with deterministic in-process responses. The
 * tests deliberately cover terminal paths while timeout decisions are pending,
 * because clearing a timer cannot cancel an already-running async callback.
 */
import {
  LLMProvider,
  __setMaxGenerationMsForTest,
  setTimeoutPromptHandler,
} from '../src/core/provider';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingTimeouts(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
}

class CountingSignal {
  aborted = false;
  additions = 0;
  removals = 0;
  private readonly listeners = new Set<() => void>();

  addEventListener(type: string, listener: () => void): void {
    if (type !== 'abort') return;
    this.additions++;
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type !== 'abort') return;
    this.removals++;
    this.listeners.delete(listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    for (const listener of this.listeners) listener();
  }

  asAbortSignal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
}

function streamingResponse(chunks: string[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of chunks) yield { choices: [{ delta: { content } }] };
    },
  };
}

async function expectFailure(provider: LLMProvider, signal?: AbortSignal): Promise<string> {
  try {
    await provider.chatWithTools([{ role: 'user', content: 'probe' }], undefined, () => {}, signal);
  } catch (error: any) {
    return error?.message ?? '';
  }
  return '';
}

async function main(): Promise<void> {
  console.log('=== Test provider resource lifecycle (T23.10) ===\n');
  __setMaxGenerationMsForTest(1000);
  setTimeoutPromptHandler(undefined);

  // Immediate authentication failure must release both timers and its abort listener.
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const signal = new CountingSignal();
    let calls = 0;
    (provider as any).client.chat.completions.create = async () => {
      calls++;
      const error: any = new Error('401 Unauthorized');
      error.status = 401;
      throw error;
    };
    const before = pendingTimeouts();
    const message = await expectFailure(provider, signal.asAbortSignal());
    check('PL.1a', calls === 1 && /Communication error/i.test(message), '401 is terminal and is not retried');
    check('PL.1b', signal.additions === 1 && signal.removals === 1, '401 removes its abort listener exactly once');
    check('PL.1c', pendingTimeouts() <= before, '401 leaves no provider timeout active');
  }

  // A network failure before an SSE response has the same cleanup guarantee.
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const signal = new CountingSignal();
    (provider as any).client.chat.completions.create = async () => {
      throw new Error('connect ECONNREFUSED fake.local:80');
    };
    const message = await expectFailure(provider, signal.asAbortSignal());
    check('PL.2a', /Communication error/i.test(message), 'pre-stream network failure reaches the terminal error path');
    check('PL.2b', signal.additions === 1 && signal.removals === 1, 'pre-stream failure removes its abort listener');
  }

  // Errors raised by the stream after a first token must not leave generation state behind.
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const signal = new CountingSignal();
    (provider as any).client.chat.completions.create = async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'partial' } }] };
        throw new Error('stream disconnected');
      },
    });
    const before = pendingTimeouts();
    const message = await expectFailure(provider, signal.asAbortSignal());
    check('PL.3a', /Communication error/i.test(message), 'mid-stream failure is reported as a provider error');
    check('PL.3b', signal.additions === 1 && signal.removals === 1, 'mid-stream failure removes its abort listener');
    check('PL.3c', pendingTimeouts() <= before, 'mid-stream failure leaves no provider timeout active');
  }

  // Retry creates a fresh owner per attempt and cleans both owners.
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const signal = new CountingSignal();
    let calls = 0;
    (provider as any).client.chat.completions.create = async () => {
      calls++;
      if (calls === 1) throw new Error('Failed to parse tool call arguments as JSON');
      return streamingResponse(['retry ok']);
    };
    const response = await provider.chatWithTools(
      [{ role: 'user', content: 'probe' }], undefined, () => {}, signal.asAbortSignal(), undefined,
    );
    check('PL.4a', calls === 2 && response.content === 'retry ok', 'a classified transient failure retries successfully');
    check('PL.4b', signal.additions === 2 && signal.removals === 2, 'retry cleans the listener from every attempt');
  }

  // Abort is terminal and must not be converted into a late timeout decision.
  {
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    (provider as any).client.chat.completions.create = async (_params: unknown, options: { signal: AbortSignal }) => {
      requestSignal = options.signal;
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise<never>((_resolve, reject) => {
            requestSignal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
          });
        },
      };
    };
    const pending = expectFailure(provider, controller.signal);
    await sleep(10);
    controller.abort();
    const message = await pending;
    check('PL.5a', message.length > 0, 'external abort terminates the pending request');
    check('PL.5b', pendingTimeouts() === 0, 'external abort leaves no provider timeout active');
  }

  // The important race: a timeout decision is already awaiting when the stream succeeds.
  // The continuation must not reschedule a timer after finally has invalidated the owner.
  {
    __setMaxGenerationMsForTest(15);
    let decisions = 0;
    setTimeoutPromptHandler(async (info) => {
      if (info.type !== 'generation_duration') return 'abort';
      decisions++;
      await sleep(35);
      return 'extend';
    });
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    (provider as any).client.chat.completions.create = async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'done' } }] };
        await sleep(20);
      },
    });
    const response = await provider.chatWithTools([{ role: 'user', content: 'probe' }], undefined, () => {});
    await sleep(60);
    check('PL.6a', response.content === 'done', 'a stream can complete while a timeout decision is pending');
    check('PL.6b', decisions === 1, 'a late extend continuation cannot recreate a provider timeout');
    check('PL.6c', pendingTimeouts() === 0, 'late timeout continuation leaves no active timer');
    setTimeoutPromptHandler(undefined);
  }

  // A normal non-stream response also releases the generation owner.
  {
    __setMaxGenerationMsForTest(1000);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'mock-model');
    const signal = new CountingSignal();
    (provider as any).client.chat.completions.create = async () => ({
      choices: [{ message: { content: 'ok' } }],
      usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 },
    });
    const response = await provider.chatWithTools(
      [{ role: 'user', content: 'probe' }], undefined, undefined, signal.asAbortSignal(), undefined,
    );
    check('PL.7a', response.content === 'ok', 'non-stream success remains unchanged');
    check('PL.7b', signal.additions === 1 && signal.removals === 1, 'non-stream success removes its abort listener');
  }

  setTimeoutPromptHandler(undefined);
  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
