export function sttCostMicroUsd(audioMs: number, usdPerMinute: number): bigint {
  return BigInt(Math.ceil(Math.round((audioMs / 60_000) * usdPerMinute * 1e6 * 1e6) / 1e6));
}

export function llmCostMicroUsd(
  inputTokens: number,
  outputTokens: number,
  usdPerMTokIn: number,
  usdPerMTokOut: number,
): bigint {
  const micro = inputTokens * usdPerMTokIn + outputTokens * usdPerMTokOut;
  return BigInt(Math.ceil(Math.round(micro * 1e6) / 1e6));
}
