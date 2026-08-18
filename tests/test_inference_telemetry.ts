import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager } from '../src/safety/permissions';
import { InferenceTelemetryWidget } from '../src/tui/widgets/InferenceTelemetryWidget';
import { SidebarView } from '../src/tui/views/Sidebar';
import { isHelpShortcut } from '../src/tui/inputParser';
import {
  LLMProvider,
  InferenceTelemetryEvent,
  setInferenceTelemetrySink,
  __setLogprobsEnabledForTest,
} from '../src/core/provider';

/** Builds an async stream of OpenAI-compatible chunks with a controllable delay before the first token. */
function fakeStream(chunks: any[], prefillDelayMs: number = 0) {
  return {
    async *[Symbol.asyncIterator]() {
      if (prefillDelayMs > 0) await new Promise((r) => setTimeout(r, prefillDelayMs));
      for (const c of chunks) {
        yield c;
        await new Promise((r) => setTimeout(r, 5));
      }
    },
  };
}

function contentChunk(text: string, logprobs?: any) {
  return { choices: [{ delta: { content: text }, ...(logprobs ? { logprobs } : {}) }] };
}

describe('TUI Inference Telemetry & Latent Space Inspector (T14.7 / T14.9)', () => {

  it('InferenceTelemetryWidget: renders IDLE state with measured values only', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'idle', ttftMs: 142, tokensPerSec: 38.5, prefillTokensPerSec: 512 },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 30);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('INFERENCE TELEMETRY'), 'Must display widget title');
    assert.ok(plain.includes('IDLE'), 'Must show IDLE badge');
    assert.ok(plain.includes('TTFT: 142ms'), 'Must show TTFT from previous run');
    assert.ok(plain.includes('prefill 512 t/s'), 'Must show measured prompt ingestion speed');
  });

  it('InferenceTelemetryWidget: marks the prefill token count as an estimate', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'prefill', prefillTokens: 6420, prefillTokensEstimated: true },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 32);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('PREFILL'), 'Must show PREFILL badge');
    assert.ok(plain.includes('~6,420 tok est.'), 'Prompt size is not known yet: it must be shown as an estimate');
  });

  it('InferenceTelemetryWidget: without logprobs shows no confidence bar and no logits (T14.9)', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'decoding', ttftMs: 215, tokensPerSec: 38.5, decodedTokens: 120 },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 35);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('DECODE'), 'Must show DECODE badge');
    assert.ok(plain.includes('38.5 t/s'), 'Must show decode tokens per second');
    assert.ok(plain.includes('120 tok'), 'Must show generated token count');
    assert.ok(plain.includes('TTFT: 215ms'), 'Must show TTFT');
    assert.ok(!plain.includes('Conf'), 'No confidence bar without real logprobs');
    assert.ok(!plain.includes('Logits'), 'No latent space line without real logprobs');
  });

  it('InferenceTelemetryWidget: shows confidence and candidates when the backend provides logprobs', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: {
        phase: 'decoding',
        ttftMs: 215,
        tokensPerSec: 38.5,
        confidence: 94,
        topCandidates: [
          { token: 'const', prob: 0.82 },
          { token: 'function', prob: 0.12 },
        ],
      },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 35);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('Conf :'), 'Must show confidence bar label');
    assert.ok(plain.includes('94%'), 'Must show confidence percentage');
    assert.ok(plain.includes('"const"'), 'Must show top candidate token');
    assert.ok(plain.includes('82%'), 'Must show candidate probability');
  });

  it('TuiBridge: streaming chunks never fabricate confidence or speed (T14.9)', () => {
    const store = new TuiStore();
    const bridge = new TuiBridge(store, new PermissionManager());

    bridge.notifyTurnStart(4096);
    assert.strictEqual(store.getState().telemetry?.phase, 'prefill');
    assert.strictEqual(store.getState().telemetry?.prefillTokens, 4096);
    assert.strictEqual(store.getState().telemetry?.prefillTokensEstimated, true);

    const onChunk = bridge.createChunkHandler();
    onChunk('Hello', 'content', 'Tsuka');

    const telem = store.getState().telemetry;
    assert.strictEqual(telem?.phase, 'decoding', 'The chunk leaves the prefill phase');
    assert.strictEqual(telem?.confidence, undefined, 'The bridge must not invent a confidence value');
    assert.strictEqual(telem?.tokensPerSec, undefined, 'Speed comes from the provider, not from chunk counting');
  });

  it('TuiBridge: telemetry lifecycle driven by real provider events', () => {
    const store = new TuiStore();
    const bridge = new TuiBridge(store, new PermissionManager());

    bridge.notifyTurnStart(4096);

    bridge.handleInferenceTelemetry({ type: 'first_token', ttftMs: 231 });
    assert.strictEqual(store.getState().telemetry?.phase, 'decoding');
    assert.strictEqual(store.getState().telemetry?.ttftMs, 231, 'TTFT comes from the provider clock');

    bridge.handleInferenceTelemetry({
      type: 'decode',
      tokens: 40,
      decodeMs: 1000,
      confidence: 91.4,
      topCandidates: [{ token: ' the', prob: 0.914 }],
    });

    const decoding = store.getState().telemetry;
    assert.strictEqual(decoding?.tokensPerSec, 40, '40 tokens in 1s = 40 t/s over the decode window');
    assert.strictEqual(decoding?.decodedTokens, 40);
    assert.strictEqual(decoding?.confidence, 91.4, 'Confidence is passed through unchanged');

    const onStats = bridge.createStatsHandler();
    onStats({
      durationMs: 1500,
      decodeMs: 1000,
      tokenCount: 40,
      tokensPerSecond: 40,
      promptTokens: 3900,
      totalTokens: 3940,
      ttftMs: 231,
      prefillTokensPerSecond: 16883.1,
    });

    const idle = store.getState().telemetry;
    assert.strictEqual(idle?.phase, 'idle');
    assert.strictEqual(idle?.prefillTokens, 3900, 'At end of turn the prompt size becomes exact');
    assert.strictEqual(idle?.prefillTokensEstimated, false);
    assert.strictEqual(idle?.prefillTokensPerSec, 16883.1);
    assert.strictEqual(idle?.confidence, undefined, 'Confidence refers to a token no longer being generated');
  });

  it('TuiBridge: an interrupted turn leaves no stale latent state', () => {
    const store = new TuiStore();
    const bridge = new TuiBridge(store, new PermissionManager());

    bridge.notifyTurnStart(1024);
    bridge.handleInferenceTelemetry({ type: 'first_token', ttftMs: 120 });
    bridge.handleInferenceTelemetry({ type: 'decode', tokens: 5, decodeMs: 200, confidence: 80 });

    bridge.resetCurrentTurn();

    const telem = store.getState().telemetry;
    assert.strictEqual(telem?.phase, 'idle');
    assert.strictEqual(telem?.confidence, undefined);
    assert.strictEqual(telem?.topCandidates, undefined);
  });

  it('LLMProvider: decode speed excludes the prefill window (T14.9)', async () => {
    __setLogprobsEnabledForTest(false);
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'fake-model');
    (provider as any).client.chat.completions.create = async () =>
      fakeStream(
        [
          contentChunk('Hello'),
          contentChunk(' world'),
          { choices: [{ delta: {} }], usage: { completion_tokens: 2, prompt_tokens: 1000, total_tokens: 1002 } },
        ],
        150
      );

    const res = await provider.chatWithTools([{ role: 'user', content: 'hi' }], undefined, () => {});
    const stats = res.stats!;

    assert.ok(stats.ttftMs !== undefined && stats.ttftMs >= 150, `TTFT must include the prefill wait (got ${stats.ttftMs}ms)`);
    assert.ok(stats.decodeMs !== undefined && stats.decodeMs < stats.durationMs, 'The decode window is shorter than the total call');
    // 2 tokens over the decode window only: including the 150ms prefill would give ~11 t/s.
    const decodeSpeed = 2 / ((stats.decodeMs as number) / 1000);
    assert.ok(Math.abs(stats.tokensPerSecond - parseFloat(decodeSpeed.toFixed(1))) < 1.5, 'tokensPerSecond is computed over the decode window');
    assert.ok(
      stats.prefillTokensPerSecond !== undefined && stats.prefillTokensPerSecond > 0,
      'Prompt ingestion speed is derived from promptTokens / TTFT'
    );
  });

  it('LLMProvider: real logprobs feed confidence and candidates when enabled', async () => {
    __setLogprobsEnabledForTest(true);
    const events: InferenceTelemetryEvent[] = [];
    setInferenceTelemetrySink((ev) => events.push(ev));

    const captured: any[] = [];
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'fake-model');
    (provider as any).client.chat.completions.create = async (params: any) => {
      captured.push(params);
      return fakeStream([
        contentChunk('const', {
          content: [
            {
              token: 'const',
              logprob: Math.log(0.8),
              top_logprobs: [
                { token: 'const', logprob: Math.log(0.8) },
                { token: 'let', logprob: Math.log(0.15) },
              ],
            },
          ],
        }),
        { choices: [{ delta: {} }], usage: { completion_tokens: 1, prompt_tokens: 10, total_tokens: 11 } },
      ]);
    };

    await provider.chatWithTools([{ role: 'user', content: 'hi' }], undefined, () => {});
    setInferenceTelemetrySink(undefined);
    __setLogprobsEnabledForTest(false);

    assert.strictEqual(captured[0]?.logprobs, true, 'Must request logprobs when the option is enabled');
    assert.strictEqual(captured[0]?.top_logprobs, 3, 'Must request the alternative candidates');

    const decodeEvent = events.find((e) => e.type === 'decode') as Extract<InferenceTelemetryEvent, { type: 'decode' }>;
    assert.ok(decodeEvent, 'Must emit a decode telemetry event');
    assert.ok(Math.abs((decodeEvent.confidence ?? 0) - 80) < 0.5, 'Confidence is exp(logprob) of the emitted token');
    assert.strictEqual(decodeEvent.topCandidates?.[1]?.token, 'let');
    assert.ok(Math.abs((decodeEvent.topCandidates?.[1]?.prob ?? 0) - 0.15) < 0.01, 'Candidate probabilities are linear');
  });

  it('LLMProvider: a backend rejecting logprobs degrades visibly and retries without them', async () => {
    __setLogprobsEnabledForTest(true);
    const captured: any[] = [];
    const provider = new LLMProvider('http://fake.local/v1', 'fake-key', 'fake-model');
    (provider as any).client.chat.completions.create = async (params: any) => {
      captured.push(params);
      if (params.logprobs) throw new Error("Unsupported parameter: 'logprobs' is not supported by this model");
      return fakeStream([
        contentChunk('ok'),
        { choices: [{ delta: {} }], usage: { completion_tokens: 1, prompt_tokens: 5, total_tokens: 6 } },
      ]);
    };

    const res = await provider.chatWithTools([{ role: 'user', content: 'hi' }], undefined, () => {});
    __setLogprobsEnabledForTest(false);

    assert.strictEqual(captured.length, 2, 'Must retry once after the rejection');
    assert.strictEqual(captured[1]?.logprobs, undefined, 'The retry must not carry the rejected parameter');
    assert.strictEqual(res.content, 'ok', 'The turn completes normally after the fallback');
  });

  it('SidebarView: mounts InferenceTelemetryWidget seamlessly in layout', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'prefill', prefillTokens: 2048, prefillTokensEstimated: true },
    });

    const rendered = SidebarView.render(store.getState(), 30, 20, ['persona', 'telemetry', 'quick_keys']);
    const plain = rendered.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('INFERENCE TELEMETRY'), 'Must embed telemetry in sidebar');
    assert.ok(plain.includes('PREFILL'), 'Must render prefill in sidebar');
  });

  it('InferenceLedsWidget: renders status LEDs across all operational phases (T14.8 Option B)', () => {
    const store = new TuiStore();

    // 1. IDLE / READY state
    store.setState({ isGenerating: false, telemetry: { phase: 'idle' } });
    let lines = SidebarView.render(store.getState(), 35, 20, ['telemetry_leds']);
    let plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('STATUS LEDS'), 'Must display LED widget header');
    assert.ok(plain.includes('[RDY]'), 'Must highlight [RDY]');
    assert.ok(plain.includes('Ready'), 'Must indicate Ready in text');

    // 2. PREFILL state
    store.setState({ isGenerating: true, telemetry: { phase: 'prefill', prefillTokens: 1024 } });
    lines = SidebarView.render(store.getState(), 35, 20, ['telemetry_leds']);
    plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('[PRE]'), 'Must highlight [PRE]');
    assert.ok(plain.includes('KV Ingestion'), 'Must indicate KV Cache ingestion');

    // 3. REASONING / THINKING state
    store.setState({ isGenerating: true, generationStatus: { phase: 'reasoning', agentName: 'Spock' } });
    lines = SidebarView.render(store.getState(), 35, 20, ['telemetry_leds']);
    plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('[THK]'), 'Must highlight [THK]');
    assert.ok(plain.includes('Thinking'), 'Must indicate reasoning in text');

    // 4. DECODE / STREAMING state
    store.setState({ isGenerating: true, generationStatus: { phase: 'streaming' }, telemetry: { phase: 'decoding' } });
    lines = SidebarView.render(store.getState(), 35, 20, ['telemetry_leds']);
    plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('[DEC]'), 'Must highlight [DEC]');
    assert.ok(plain.includes('Streaming Response'), 'Must indicate decoding in text');

    // 5. TOOL execution state
    store.setState({ isGenerating: true, generationStatus: { phase: 'tool', toolName: 'read_file' }, telemetry: { phase: 'tool' } });
    lines = SidebarView.render(store.getState(), 35, 20, ['telemetry_leds']);
    plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');
    assert.ok(plain.includes('[TOL]'), 'Must highlight [TOL]');
    assert.ok(plain.includes('Tool Execution'), 'Must indicate tool execution');
  });

  it("Help shortcut: '?' stays typable in the prompt, F12 always opens help (T14.10)", () => {
    assert.strictEqual(isHelpShortcut({ name: '?' }, 'input', false), false, "'?' with focus on input is a character");
    assert.strictEqual(isHelpShortcut({ name: '?' }, 'chat', false), true, "'?' while browsing the chat opens help");
    assert.strictEqual(isHelpShortcut({ name: '?' }, 'chat', true), false, "'?' does nothing with a modal open");
    assert.strictEqual(isHelpShortcut({ name: 'f12' }, 'input', false), true, 'F12 works from the input too');
    assert.strictEqual(isHelpShortcut({ name: 'f12' }, 'chat', true), true, 'F12 toggles help with a modal open');
  });

});
