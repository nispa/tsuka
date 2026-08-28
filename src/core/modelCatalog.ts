export type ModelCatalogFilter = 'all' | 'free';
import type { FreeModelsCapability } from './providerCatalog';

export interface ModelPricing {
  prompt?: string | number;
  completion?: string | number;
}

export function isFreeModel(modelId: string, capability: FreeModelsCapability): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (capability.aliases ?? []).some((alias) => normalized === alias.toLowerCase()) ||
    (capability.suffixes ?? []).some((suffix) => normalized.endsWith(suffix.toLowerCase()));
}

/** Some catalogues report zero pricing independently from model naming. */
export function hasZeroTokenPricing(pricing: ModelPricing | null | undefined): boolean {
  if (!pricing) return false;
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

export function filterProviderModels(
  models: string[],
  filter: ModelCatalogFilter,
  capability?: FreeModelsCapability,
  zeroPricedModels: readonly string[] = []
): string[] {
  if (!capability || filter !== 'free') return models;
  const zeroPriced = new Set(zeroPricedModels);
  return models.filter((model) => isFreeModel(model, capability) ||
    (capability.includeZeroPriced === true && zeroPriced.has(model)));
}
