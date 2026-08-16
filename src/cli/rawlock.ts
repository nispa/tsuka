/**
 * Persistent raw mode lock for interactive session.
 *
 * On Windows, switching between raw and cooked modes can leave pending ReadConsole
 * handles in libuv, causing frozen terminal states. Locking raw mode for the process
 * duration and restoring cooked mode on exit avoids stdin lockups.
 */
export function lockRawMode(): void {
  if (!process.stdin.isTTY) return;

  const stdin = process.stdin;
  const realSetRawMode = stdin.setRawMode.bind(stdin);

  realSetRawMode(true);

  stdin.setRawMode = ((mode: boolean) => {
    if (mode) {
      realSetRawMode(true);
    }
    return stdin;
  }) as typeof stdin.setRawMode;

  const restore = () => {
    try { realSetRawMode(false); } catch {}
  };
  process.on('exit', restore);
}
