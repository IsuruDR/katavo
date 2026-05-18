import { TIER_CONFIG, resolveTier } from "../../../config.js";

export interface GateDecision {
  fire: boolean;
}

export function evaluateQualityGate(
  rawTier: string | undefined,
  auditFindingsCount: number,
): GateDecision {
  const tier = resolveTier(rawTier);
  return { fire: auditFindingsCount >= TIER_CONFIG[tier].gateFireThreshold };
}
