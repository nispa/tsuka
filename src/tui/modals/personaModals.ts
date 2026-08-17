import { TuiStore } from '../store';
import { ConfigManager } from '../../core/config';
import { listAvailableCharacters, listAvailableTeams } from '../../cli/shared';

export class PersonaModals {
  static openPersonaModal(
    store: TuiStore,
    configManager: ConfigManager,
    onAgentRecreate: () => void,
    onSyncState: () => void
  ): void {
    const characters = listAvailableCharacters();
    const options = characters.map((c) => ({
      label: `👤 ${c.aiName || c.displayName}`,
      value: c.name,
      hint: `${c.role || (c.roles && c.roles[0]) || 'developer'} • ${c.trait || 'helpful'}${c.reasoningEffort ? ' • 🧠 ' + c.reasoningEffort : ''}`,
    }));

    store.showModal({
      type: 'slash_menu',
      title: 'Select Active Persona',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        configManager.setActiveCharacter(chosen);
        onAgentRecreate();
        onSyncState();
        store.closeModal();
        store.notify(`Active persona changed to: ${chosen}`, 'success');
      },
    });
  }

  static openTeamModal(store: TuiStore): void {
    const teams = listAvailableTeams();
    const options = teams.map((t) => ({
      label: `🤝 ${t.displayName || t.name}`,
      value: t.name,
      hint: `${t.members.join(', ')} [${t.mode || 'orchestrated'}]`,
    }));

    store.showModal({
      type: 'slash_menu',
      title: 'Select Multi-Agent Team',
      selectedIndex: 0,
      options,
      onSelect: (chosen) => {
        store.setState({ activeTeam: chosen });
        store.closeModal();
        store.notify(`Active team switched to: ${chosen}`, 'success');
      },
    });
  }
}
