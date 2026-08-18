import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { TuiStore } from '../store';
import { resolveSafePath, isBinaryFile } from '../../tools/impl/utils';

export class FileViewerModal {
  static openFileModal(store: TuiStore, rawFilename: string): void {
    try {
      const fullPath = resolveSafePath(rawFilename);
      if (!fs.existsSync(fullPath)) {
        store.notify(`File not found: ${rawFilename}`, 'error');
        return;
      }

      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        store.notify(`Cannot preview directory '${rawFilename}' as a text file`, 'warn');
        return;
      }

      if (isBinaryFile(fullPath)) {
        store.notify(`Binary file '${rawFilename}' cannot be previewed in text mode`, 'warn');
        return;
      }

      // Check size (cap preview at 2MB to keep TUI ultra responsive)
      if (stat.size > 2 * 1024 * 1024) {
        store.notify(`File '${rawFilename}' exceeds 2MB preview limit`, 'warn');
        return;
      }

      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const lines = rawContent.split(/\r?\n/);
      const filename = path.basename(fullPath);
      const relativePath = path.relative(process.cwd(), fullPath) || filename;

      store.showModal({
        type: 'file_viewer',
        title: `📄 File Viewer: ${relativePath}`,
        selectedIndex: 0,
        fileViewer: {
          filename,
          filePath: fullPath,
          lines,
          scrollOffset: 0,
          totalLines: lines.length,
          fileSize: stat.size,
        },
      });
    } catch (err: any) {
      store.notify(`Error opening file: ${err.message || String(err)}`, 'error');
    }
  }
}
