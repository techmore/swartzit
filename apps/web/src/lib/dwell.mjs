// Ignore long gaps (device sleep/throttled timers) rather than crediting them.
export function createDwellClock(now) {
  let last = now, eligible = false, elapsed = 0;
  return {
    sample(now, nextEligible) {
      const delta = Math.max(0, now - last);
      if (eligible && delta <= 2000) elapsed += delta;
      last = now; eligible = nextEligible;
      return elapsed;
    }
  };
}
