/** Human-friendly date formatting for list rows and detail headers. */

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const deltaMs = now - timestamp;
  if (Number.isNaN(deltaMs)) return '';

  const abs = Math.abs(deltaMs);
  if (abs < 60_000) return 'just now';

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_557_600_000],
    ['month', 2_592_000_000],
    ['week', 604_800_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
  for (const [unit, ms] of units) {
    if (abs >= ms) return formatter.format(-Math.round(deltaMs / ms), unit);
  }
  return 'just now';
}

export function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
