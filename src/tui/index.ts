#!/usr/bin/env node
/**
 * TSUKA TUI — Terminal User Interface Entry Point.
 */

import * as dotenv from 'dotenv';
import { homePath } from '../core/apphome';
import { ConfigManager } from '../core/config';
import { LLMProvider, setLlmTimeoutMs } from '../core/provider';
import { createDefaultRegistry } from '../tools/index';
import { PermissionManager } from '../safety/permissions';
import { TuiApp } from './app';

dotenv.config({ path: homePath('.env') });

export async function launchTui(): Promise<void> {
  const configManager = new ConfigManager();
  setLlmTimeoutMs(configManager.getLlmTimeoutMs());

  const permissionManager = new PermissionManager();
  const registry = await createDefaultRegistry();

  const activeConfig = configManager.getActiveProviderConfig();
  const provider = new LLMProvider(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model);

  const app = new TuiApp({
    configManager,
    provider,
    registry,
    permissionManager,
  });

  app.start();
}

// Auto-start if executed directly as main script
if (require.main === module) {
  launchTui().catch((err) => {
    console.error('Fatal TUI error:', err);
    process.exit(1);
  });
}
