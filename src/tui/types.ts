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

export interface TuiModalState {
  type: 'permission' | 'help' | 'slash_menu' | 'confirm';
  title: string;
  permissionReq?: TuiPermissionRequest;
  selectedIndex: number;
  options?: Array<{ label: string; value: string; hint?: string }>;
  onSelect?: (value: string) => void;
  onCancel?: () => void;
}

export interface TuiStats {
  usedTokens: number;
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
  isGenerating: boolean;
  expandAllThinking?: boolean;
  activeTeam?: string;
  isRawModeLocked: boolean;
  workspaceFiles: TuiFileItem[];
  notifications: Array<{ id: string; text: string; type: 'info' | 'warn' | 'error' | 'success'; timestamp: number }>;
}
