#!/usr/bin/env node
/**
 * TSUKA TUI — Terminal User Interface Entry Point.
 */

import * as dotenv from 'dotenv';
import { homePath } from '../core/apphome';
import { createHarnessRuntime } from '../core/runtime';
import { TuiApp } from './app';
import { logSink } from '../core/logSink';

dotenv.config({ path: homePath('.env') });
dotenv.config();

export async function launchTui(): Promise<void> {
  const runtime = await createHarnessRuntime({
    connectMcp: true,
  });

  const app = new TuiApp({
    configManager: runtime.configManager,
    provider: runtime.provider,
    registry: runtime.registry,
    permissionManager: runtime.permissionManager,
    onShutdown: async () => {
      await runtime.close();
    },
  });

  app.start();
}

// Auto-start if executed directly as main script
if (require.main === module) {
  launchTui().catch((err) => {
    logSink.error(`Fatal TUI error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
