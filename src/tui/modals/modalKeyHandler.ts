import { KeyPressEvent } from '../inputParser';
import { TuiStore } from '../store';
import { TuiModalState } from '../types';

export class ModalKeyHandler {
  static handleKey(key: KeyPressEvent, modal: TuiModalState, store: TuiStore): void {
    if (key.name === 'escape') {
      store.closeModal();
      return;
    }

    if (modal.type === 'file_viewer' && modal.fileViewer) {
      const fv = modal.fileViewer;
      if (key.name === 'escape' || key.name === 'q' || key.name === 'Q') {
        store.closeModal();
        return;
      }
      if (key.name === 'up') {
        const next = Math.max(0, fv.scrollOffset - 1);
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: next } });
        return;
      }
      if (key.name === 'down') {
        const next = Math.min(fv.totalLines - 1, fv.scrollOffset + 1);
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: next } });
        return;
      }
      if (key.name === 'pageup') {
        const next = Math.max(0, fv.scrollOffset - 15);
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: next } });
        return;
      }
      if (key.name === 'pagedown') {
        const next = Math.min(fv.totalLines - 1, fv.scrollOffset + 15);
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: next } });
        return;
      }
      if (key.name === 'home' || key.name === 'g') {
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: 0 } });
        return;
      }
      if (key.name === 'end' || key.name === 'G') {
        const next = Math.max(0, fv.totalLines - 15);
        store.showModal({ ...modal, fileViewer: { ...fv, scrollOffset: next } });
        return;
      }
      if (key.name === 'i' || key.name === 'I') {
        const currentInput = store.getState().inputText;
        const insertText = (currentInput ? currentInput + ' ' : '') + fv.filename;
        store.setInputText(insertText);
        store.setFocus('input');
        store.closeModal();
        store.notify(`Inserted '${fv.filename}' into input prompt`, 'info');
        return;
      }
      if (key.name === 'c' || key.name === 'C') {
        const { copyToClipboard } = require('../../core/platform');
        const ok = copyToClipboard(fv.filePath);
        if (ok) store.notify(`Copied path '${fv.filePath}' to clipboard`, 'success');
        return;
      }
      if (key.name === 'return') {
        store.closeModal();
        return;
      }
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
