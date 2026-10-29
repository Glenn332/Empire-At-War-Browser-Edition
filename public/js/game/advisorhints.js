export const advisorHintFlags = saved => ({
  Galactic: saved?.Galactic ?? true,
  Space: saved?.Space ?? true,
  Land: saved?.Land ?? true
});

export const advisorHints = player => (player.advisorHints ||= advisorHintFlags());
