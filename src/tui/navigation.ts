/**
 * Top navigation table of the TUI.
 *
 * One row per tab describes everything about it: the function key that reaches
 * it, the labels for each terminal width, and the modal it toggles (when it
 * opens one instead of switching view). Header rendering and mouse hit-testing
 * both derive from this table, so a label can never drift from its click zone.
 */

import { BoxDrawing } from './boxDrawing';

export interface TuiTabSpec {
  id: string;
  /** Function key that activates the tab (`inputParser` key names). */
  key: string;
  /** Labels for narrow (<80), medium (<110) and wide terminals. */
  labels: [string, string, string];
  /** Wording used by the help cheatsheet. */
  description: string;
  /**
   * Modal this tab toggles. Tabs without one switch the main view instead.
   * Matched as a substring of the open modal title.
   */
  modalTitle?: string;
}

export const TUI_TABS: TuiTabSpec[] = [
  { id: 'chat', key: 'f1', labels: ['F1 Chat', 'F1 Chat', 'F1 💬 Chat'], description: 'Chat Feed view' },
  { id: 'tools', key: 'f2', labels: ['F2 Tools', 'F2 Tools', 'F2 ⚡ Tools'], description: 'Tools Inspector view' },
  { id: 'personas', key: 'f3', labels: ['F3', 'F3 Personas', 'F3 👥 Personas'], description: 'Persona Picker popup', modalTitle: 'Select Active Persona' },
  { id: 'teams', key: 'f4', labels: ['F4', 'F4 Teams', 'F4 🤝 Teams'], description: 'Team Picker popup', modalTitle: 'Select Active Team' },
  { id: 'memory', key: 'f5', labels: ['F5', 'F5 Mem', 'F5 🧠 Memory'], description: 'Memory Facts popup', modalTitle: 'Persistent Memories' },
  { id: 'models', key: 'f6', labels: ['F6', 'F6 Models', 'F6 ⚡ Models'], description: 'LLM Backend Models popup', modalTitle: 'Select Active Model' },
  { id: 'layout', key: 'f7', labels: ['F7', 'F7 Layout', 'F7 📐 Layout'], description: 'Layout, themes & panes editor', modalTitle: 'TUI Layout & Workspace Configuration' },
  { id: 'help', key: 'f12', labels: ['F12', 'F12', 'F12 Help'], description: 'This cheatsheet', modalTitle: 'Cheatsheet' },
];

export function tabByKey(keyName: string): TuiTabSpec | undefined {
  return TUI_TABS.find((t) => t.key === keyName);
}

export function labelForWidth(spec: TuiTabSpec, width: number): string {
  if (width < 80) return spec.labels[0];
  if (width < 110) return spec.labels[1];
  return spec.labels[2];
}

/** A tab as placed on the header row: 1-based inclusive column range. */
export interface TuiTabZone {
  spec: TuiTabSpec;
  label: string;
  isActive: boolean;
  start: number;
  end: number;
}

/**
 * Places the tabs on the header row exactly as `HeaderView` draws them:
 * one leading space, then ` label ` (active) or `[label]` (inactive), each
 * followed by a separating space. Colours do not change widths, so these
 * ranges are what the mouse must hit.
 */
export function layoutTabs(width: number, activeTab: string): TuiTabZone[] {
  const zones: TuiTabZone[] = [];
  let column = 2;

  for (const spec of TUI_TABS) {
    const label = labelForWidth(spec, width);
    const cellWidth = BoxDrawing.stringWidth(label) + 2;
    zones.push({ spec, label, isActive: activeTab === spec.id, start: column, end: column + cellWidth - 1 });
    column += cellWidth + 1;
  }

  return zones;
}

export function tabAtColumn(width: number, activeTab: string, column: number): TuiTabSpec | undefined {
  return layoutTabs(width, activeTab).find((z) => column >= z.start && column <= z.end)?.spec;
}
