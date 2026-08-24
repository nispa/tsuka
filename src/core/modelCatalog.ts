export type ModelCatalogFilter = 'all' | 'free';

export interface ModelPricing {
  prompt?: string | number;
  completion?: string | number;
}

/** OpenRouter publishes free variants with a `:free` suffix and a free router alias. */
export function isFreeOpenRouterModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return normalized === 'openrouter/free' || normalized.endsWith(':free');
}

/** OpenRouter may publish temporary free models without adding `:free` to their IDs. */
export function hasZeroTokenPricing(pricing: ModelPricing | null | undefined): boolean {
  if (!pricing) return false;
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt === 0 && completion === 0;
}

export function filterOpenRouterModels(
  providerName: string,
  models: string[],
  filter: ModelCatalogFilter,
  zeroPricedModels: readonly string[] = []
): string[] {
  if (providerName !== 'openrouter' || filter !== 'free') return models;
  const zeroPriced = new Set(zeroPricedModels);
  return models.filter((model) => isFreeOpenRouterModel(model) || zeroPriced.has(model));
}
