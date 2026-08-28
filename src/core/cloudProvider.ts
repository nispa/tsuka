export type ProviderClass = 'LOCAL' | 'CLOUD';

/** Provider policy classes are declared by each provider entry in tsuka.config.json. */
export function normalizeProviderClass(value: unknown): ProviderClass {
  return typeof value === 'string' && value.trim().toUpperCase() === 'CLOUD' ? 'CLOUD' : 'LOCAL';
}
