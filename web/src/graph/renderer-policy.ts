export type RendererFeaturePolicy = Readonly<{
  advancedAdapterVerified: boolean;
}>;

/** Advanced rendering remains opt-in until its adapter passes browser compatibility checks. */
export function selectRendererAdapter<T>(
  policy: RendererFeaturePolicy,
  baseline: T,
  advanced: T | null,
): T {
  return policy.advancedAdapterVerified && advanced !== null ? advanced : baseline;
}
