const WARNING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Notification dates come only from the operator-verified agreement, never a client date. */
export function eduExpiryWarning(agreement: {
  expiryWarningEnabled: boolean;
  verifiedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}, now = new Date()) {
  const startsAt = new Date(agreement.expiresAt.getTime() - WARNING_WINDOW_MS);
  return {
    enabled: agreement.expiryWarningEnabled,
    startsAt,
    due: agreement.expiryWarningEnabled && agreement.revokedAt === null &&
      agreement.verifiedAt <= now && startsAt <= now && now < agreement.expiresAt,
  };
}
