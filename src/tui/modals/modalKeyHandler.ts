import { KeyPressEvent } from '../inputParser';
import { TuiStore } from '../store';
import { TuiModalState } from '../types';

export class ModalKeyHandler {
  static handleKey(key: KeyPressEvent, modal: TuiModalState, store: TuiStore): void {
    if (key.name === 'escape') {
      store.closeModal();
      return;
    }

    if (modal.type === 'permission' && modal.permissionReq) {
      if (key.name === 'y' || key.name === 'Y') {
        modal.permissionReq.resolve('yes');
        return;
      }
      if (key.name === 'n' || key.name === 'N') {
        modal.permissionReq.resolve('no');
        return;
      }
      if (key.name === 'a' || key.name === 'A') {
        modal.permissionReq.resolve('always');
        return;
      }
    }

    if (modal.options && modal.options.length > 0) {
      if (key.name === 'up') {
        const next = Math.max(0, modal.selectedIndex - 1);
        store.showModal({ ...modal, selectedIndex: next });
      } else if (key.name === 'down') {
        const next = Math.min(modal.options.length - 1, modal.selectedIndex + 1);
        store.showModal({ ...modal, selectedIndex: next });
      } else if (key.name === 'return') {
        const chosen = modal.options[modal.selectedIndex];
        if (modal.onSelect && chosen) {
          modal.onSelect(chosen.value);
        } else if (modal.permissionReq && chosen) {
          modal.permissionReq.resolve(chosen.value as 'yes' | 'no' | 'always');
        }
      }
    } else {
      if (key.name === 'return') {
        store.closeModal();
      }
    }
  }
}
