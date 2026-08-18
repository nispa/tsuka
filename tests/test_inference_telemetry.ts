import { describe, it } from 'node:test';
import assert from 'node:assert';
import { TuiStore } from '../src/tui/store';
import { TuiScreen } from '../src/tui/screen';
import { TuiBridge } from '../src/tui/bridge';
import { PermissionManager } from '../src/safety/permissions';
import { InferenceTelemetryWidget } from '../src/tui/widgets/InferenceTelemetryWidget';
import { SidebarView } from '../src/tui/views/Sidebar';

describe('TUI Inference Telemetry & Latent Space Inspector (T14.7)', () => {

  it('InferenceTelemetryWidget: renders IDLE state cleanly', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'idle', ttftMs: 142 },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 30);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('INFERENCE TELEMETRY'), 'Must display widget title');
    assert.ok(plain.includes('IDLE'), 'Must show IDLE badge');
    assert.ok(plain.includes('TTFT: 142ms'), 'Must show TTFT from previous run');
  });

  it('InferenceTelemetryWidget: renders PREFILL / KV Cache Ingestion state', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: {
        phase: 'prefill',
        prefillTokens: 6420,
        prefillTokensPerSec: 512,
      },
    });

    const lines = InferenceTelemetryWidget.render(store.getState(), 32);
    const plain = lines.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('PREFILL'), 'Must show PREFILL badge');
    assert.ok(plain.includes('6,420 tok'), 'Must show prefill token count');
    assert.ok(plain.includes('512 t/s'), 'Must show prefill ingestion speed');
  });

  it('InferenceTelemetryWidget: renders DECODE streaming, TTFT, confidence bar and logits', () => {
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

    assert.ok(plain.includes('DECODE'), 'Must show DECODE badge');
    assert.ok(plain.includes('38.5 t/s'), 'Must show decode tokens per second');
    assert.ok(plain.includes('TTFT: 215ms'), 'Must show TTFT');
    assert.ok(plain.includes('Conf :'), 'Must show confidence bar label');
    assert.ok(plain.includes('94%'), 'Must show confidence percentage');
    assert.ok(plain.includes('"const"'), 'Must show top candidate token');
    assert.ok(plain.includes('82%'), 'Must show candidate probability');
  });

  it('TuiBridge: manages live telemetry lifecycle from prefill to decode to idle', () => {
    const store = new TuiStore();
    const perm = new PermissionManager();
    const bridge = new TuiBridge(store, perm);

    // 1. Turn Start -> Prefill
    bridge.notifyTurnStart(4096);
    assert.strictEqual(store.getState().telemetry?.phase, 'prefill');
    assert.strictEqual(store.getState().telemetry?.prefillTokens, 4096);

    // 2. First Chunk -> Decoding with TTFT
    const onChunk = bridge.createChunkHandler();
    onChunk('Hello', 'content', 'Tsuka');

    const streamingTelem = store.getState().telemetry;
    assert.strictEqual(streamingTelem?.phase, 'decoding');
    assert.ok(typeof streamingTelem?.ttftMs === 'number', 'Must record numerical TTFT');

    // 3. Stats -> Idle
    const onStats = bridge.createStatsHandler();
    onStats({ durationMs: 500, tokenCount: 20, tokensPerSecond: 40, promptTokens: 4096, totalTokens: 4116 });

    assert.strictEqual(store.getState().telemetry?.phase, 'idle');
    assert.strictEqual(store.getState().telemetry?.tokensPerSec, 40);
  });

  it('SidebarView: mounts InferenceTelemetryWidget seamlessly in layout', () => {
    const store = new TuiStore();
    store.setState({
      telemetry: { phase: 'prefill', prefillTokens: 2048 },
    });

    const rendered = SidebarView.render(store.getState(), 30, 20, ['persona', 'telemetry', 'quick_keys']);
    const plain = rendered.map((l) => TuiScreen.stripAnsi(l)).join('\n');

    assert.ok(plain.includes('INFERENCE TELEMETRY'), 'Must embed telemetry in sidebar');
    assert.ok(plain.includes('PREFILL'), 'Must render prefill in sidebar');
  });

});
