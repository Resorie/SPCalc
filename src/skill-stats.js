// Half-open activation windows [start, end); damage is classified by actual HP-loss time.
export function skillWindowStats(timeline, damageByTime, endTime) {
  const intervals = [];
  let start = null;
  const close = end => {
    if (start !== null && end > start) intervals.push([start, end]);
    start = null;
  };
  for (const event of timeline) {
    const t = Math.max(0, Math.min(endTime, event.t));
    if (event.kind === 'skillStart' && start === null) start = t;
    if (event.kind === 'skillEnd') close(t);
  }
  close(endTime);
  const duration = intervals.reduce((sum, [a,b]) => sum + b-a, 0);
  let damage = 0;
  for (const [t, amount] of damageByTime) {
    if (intervals.some(([a,b]) => t >= a && t < b)) damage += amount;
  }
  return { duration, damage, dps: duration > 0 ? damage / duration : null, intervals };
}
