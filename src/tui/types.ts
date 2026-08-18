/**
 * Type definitions for TSUKA Terminal User Interface (TUI).
 */

import { RiskLevel } from '../safety/permissions';
import { ProtocolSource, Vote } from '../core/types';

export type TuiFocus = 'input' | 'chat' | 'sidebar' | 'files' | 'tools';

export interface TuiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  authorName?: string;
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  thinkingContent?: string;
  thinkingTokens?: number;
  isThinkingExpanded?: boolean;
  isQueued?: boolean;
  queuePosition?: number;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
    output?: string;
    status: 'running' | 'completed' | 'failed';
    durationMs?: number;
  }>;
}

export interface TuiToolExecution {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'completed' | 'failed';
  output?: string;
  startedAt: number;
  completedAt?: number;
  riskLevel?: RiskLevel;
}

export interface TuiPermissionRequest {
  id: string;
  toolName: string;
  details: string;
  riskLevel: RiskLevel;
  requesterLabel?: string;
  resolve: (decision: 'yes' | 'no' | 'always') => void;
}

export interface TuiFileViewerState {
  filename: string;
  filePath: string;
  lines: string[];
  scrollOffset: number;
  totalLines: number;
  fileSize: number;
}

export interface TuiModalState {
  type: 'permission' | 'help' | 'slash_menu' | 'confirm' | 'file_viewer';
  title: string;
  permissionReq?: TuiPermissionRequest;
  fileViewer?: TuiFileViewerState;
  selectedIndex: number;
  options?: Array<{ label: string; value: string; hint?: string }>;
  onSelect?: (value: string) => void;
  onCancel?: () => void;
}

export interface TuiStats {
  usedTokens: number;
  subagentUsedTokens?: number;
  totalSessionTokens?: number;
  maxTokens: number;
  percentage: number;
  turnCount: number;
  toolCallsCount: number;
  reasoningEffort?: string;
}

export interface TuiFileItem {
  name: string;
  isDir: boolean;
  size?: number;
  ext?: string;
}

export interface TuiSpawnedAgent {
  id: string;
  name: string;
  role: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  currentTool?: string;
  usedTokens: number;
  startedAt: number;
  completedAt?: number;
}

export interface TuiGenerationStatus {
  phase: 'idle' | 'reasoning' | 'streaming' | 'tool';
  agentName?: string;
  toolName?: string;
}

export interface TuiInferenceCandidate {
  token: string;
  prob: number;
}

export interface TuiInferenceTelemetry {
  phase: 'idle' | 'prefill' | 'decoding' | 'tool';
  /** Prompt tokens: an estimate while ingesting, the exact figure once usage arrives. */
  prefillTokens?: number;
  prefillTokensEstimated?: boolean;
  /** Prompt ingestion speed measured on the previous turn (promptTokens / TTFT). */
  prefillTokensPerSec?: number;
  ttftMs?: number;
  tokensPerSec?: number;
  /** Tokens generated in the current turn, as counted by the provider. */
  decodedTokens?: number;
  /** Real confidence (0-100) of the last emitted token: only with backend logprobs. */
  confidence?: number;
  /** Alternatives weighed by the model: only with backend logprobs. */
  topCandidates?: TuiInferenceCandidate[];
  lastUpdated?: number;
}

export interface TuiState {
  activeCharacterName: string;
  activeCharacterRole: string;
  activeCharacterTrait: string;
  activeAiName: string;
  activeProvider: string;
  activeModel: string;
  activeReasoningEffort?: string;
  activeEffortSource?: string;
  characterRecommendedEffort?: string;
  activeSpawnedAgent: TuiSpawnedAgent | null;
  spawnedAgentsHistory: TuiSpawnedAgent[];
  generationStatus?: TuiGenerationStatus;
  telemetry?: TuiInferenceTelemetry;
  stats: TuiStats;
  messages: TuiChatMessage[];
  activeTools: TuiToolExecution[];
  activeModal: TuiModalState | null;
  focus: TuiFocus;
  inputText: string;
  inputCursor: number;
  inputHistory: string[];
  historyIndex: number;
  chatScrollOffset: number;
  sidebarScrollOffset: number;
  filesScrollOffset: number;
  selectedFileIndex: number;
  toolsScrollOffset: number;
  toolsFilter?: string;
  isGenerating: boolean;
  expandAllThinking?: boolean;
  activeTeam?: string;
  isRawModeLocked: boolean;
  workspaceFiles: TuiFileItem[];
  /** Directory currently browsed in the Files Explorer, relative to the workspace root ('' = root). */
  filesCwd: string;
  notifications: Array<{ id: string; text: string; type: 'info' | 'warn' | 'error' | 'success'; timestamp: number }>;
}
