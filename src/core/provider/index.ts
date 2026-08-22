/**
 * LLM provider subsystem: OpenAI-compatible chat client with streaming, retry and
 * timeout policies, sampling-profile resolution (T8.17) and real inference telemetry
 * (T14.9). The concrete `LLMProvider` is one implementation behind the `ILLMProvider`
 * contract — consumers (Agent, team/goal strategies, TUI) depend on the contract.
 *
 * Module map:
 * - `types.ts`     — shared protocol types (`ChatOptions`, `ChatStats`, `ILLMProvider`, ...).
 * - `timeouts.ts`  — first-token / generation timeouts and the interactive timeout handler.
 * - `telemetry.ts` — inference telemetry sink + logprobs session gating.
 * - `sampling.ts`  — model-family & config-driven sampling profiles, wire params.
 * - `llmProvider.ts` — the default OpenAI-compatible implementation.
 */
export * from './types';
export * from './timeouts';
export * from './telemetry';
export * from './sampling';
export { LLMProvider } from './llmProvider';
