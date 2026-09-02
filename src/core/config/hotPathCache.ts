import { ConfigManager } from './manager';

export interface ConfigCacheMetrics {
  loads: number;
  hits: number;
}

export interface HotPathConfigCache {
  get(): ConfigManager;
  getMetrics(): Readonly<ConfigCacheMetrics>;
}

/**
 * Creates a local cache, not a second configuration singleton. A save through any
 * ConfigManager invalidates it immediately; the TTL bounds visibility of external edits.
 */
export function createHotPathConfigCache(): HotPathConfigCache {
  let manager: ConfigManager | undefined;
  let expiresAt = 0;
  let revision = -1;
  const metrics: ConfigCacheMetrics = { loads: 0, hits: 0 };

  return {
    get(): ConfigManager {
      const now = Date.now();
      const currentRevision = ConfigManager.getRevision();
      if (!manager || now >= expiresAt || revision !== currentRevision) {
        manager = new ConfigManager();
        revision = ConfigManager.getRevision();
        expiresAt = now + manager.getHotPathConfigCacheTtlMs();
        metrics.loads++;
      } else {
        metrics.hits++;
      }
      return manager;
    },
    getMetrics(): Readonly<ConfigCacheMetrics> {
      return { ...metrics };
    }
  };
}
