export function calculateEngagementScore(opts: {
  opened?: boolean;
  clicked?: boolean;
  replied?: boolean;
  unsubscribed?: boolean;
}): number {
  let score = 0;
  if (opts.replied) score += 25;
  if (opts.clicked) score += 10;
  if (opts.opened) score += 5;
  if (opts.unsubscribed) score -= 30;
  return score;
}
