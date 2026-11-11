/** Service-day seconds preserve GTFS hours beyond midnight. */
export function parseTime(value: string): number {
  if (!/^\d{2,}:\d{2}:\d{2}$/.test(value)) {
    throw new Error(`Invalid GTFS time: ${value}`);
  }
  const [hours = 0, minutes = 0, seconds = 0] = value.split(':').map(Number);
  if (minutes > 59 || seconds > 59) {
    throw new Error(`Invalid GTFS time: ${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatTime(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    throw new Error(`Invalid service-day seconds: ${seconds}`);
  }
  return [
    Math.floor(seconds / 3600),
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
