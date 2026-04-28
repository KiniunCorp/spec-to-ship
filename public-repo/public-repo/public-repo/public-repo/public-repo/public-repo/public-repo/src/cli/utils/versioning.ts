export function compareSemver(a: string, b: string): number {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (parsedA.core[i] > parsedB.core[i]) return 1;
    if (parsedA.core[i] < parsedB.core[i]) return -1;
  }
  if (!parsedA.pre && !parsedB.pre) return 0;
  if (!parsedA.pre) return 1;
  if (!parsedB.pre) return -1;
  return parsedA.pre.localeCompare(parsedB.pre);
}

export function parseSemver(value: string): { core: [number, number, number]; pre: string } {
  const raw = String(value || '0.0.0').trim();
  const [coreRaw, preRaw = ''] = raw.split('-', 2);
  const [majorRaw = '0', minorRaw = '0', patchRaw = '0'] = coreRaw.split('.', 3);
  const major = Number.parseInt(majorRaw, 10) || 0;
  const minor = Number.parseInt(minorRaw, 10) || 0;
  const patch = Number.parseInt(patchRaw, 10) || 0;
  return { core: [major, minor, patch], pre: preRaw };
}

export function formatFriendlyTimestamp(value: string | number): string {
  const millis = typeof value === 'number' ? value : Date.parse(String(value || ''));
  if (!Number.isFinite(millis)) return 'unknown';

  const target = new Date(millis);
  const absolute = [
    target.getFullYear(),
    String(target.getMonth() + 1).padStart(2, '0'),
    String(target.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`;

  const diffMs = Date.now() - millis;
  if (diffMs < 0) return `in the future (${absolute})`;

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  let relative = 'just now';
  if (diffMs >= dayMs) {
    const days = Math.floor(diffMs / dayMs);
    relative = `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (diffMs >= hourMs) {
    const hours = Math.floor(diffMs / hourMs);
    relative = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (diffMs >= minuteMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    relative = `${minutes} min ago`;
  }

  return `${relative} (${absolute})`;
}
