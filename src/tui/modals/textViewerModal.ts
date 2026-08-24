import wrapAnsi from 'wrap-ansi';
import { TuiStore } from '../store';
import { viewerHeight, viewerWidth } from '../viewerGeometry';

function viewerInnerWidth(screenWidth: number): number {
  return Math.max(6, viewerWidth(screenWidth) - 4);
}

/** Opens long plain text in a wrapped, scrollable modal instead of a one-line menu hint. */
export class TextViewerModal {
  static open(
    store: TuiStore,
    title: string,
    content: string,
    onClose?: () => void,
    screenWidth: number = Math.max(10, (process.stdout.columns || 80) - 1),
    screenHeight: number = process.stdout.rows || 24
  ): void {
    const wrapped = wrapAnsi(content, viewerInnerWidth(screenWidth), {
      hard: true,
      trim: false,
      wordWrap: true,
    }).split(/\r?\n/);
    const lines = wrapped.length > 0 ? wrapped : [''];

    store.showModal({
      type: 'text_viewer',
      title,
      selectedIndex: 0,
      textViewer: {
        lines,
        scrollOffset: 0,
        totalLines: lines.length,
        pageSize: Math.max(3, viewerHeight(screenHeight) - 3),
      },
      onCancel: onClose,
    });
  }
}
