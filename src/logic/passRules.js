export function getDefaultPassesPerRound() {
  return 3;
}

export function normalizePassSettings(settings) {
  if (!settings.passEnabled) return { enabled: false, perRound: 0, unlimited: false };
  if (settings.passMode === 'unlimited') return { enabled: true, perRound: Infinity, unlimited: true };
  return { enabled: true, perRound: Number(settings.customPassesPerRound || 3), unlimited: false };
}
