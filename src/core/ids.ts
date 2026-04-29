export function randomId(prefix: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${suffix}`;
}

export function missionIdFromCount(count: number): string {
  return `m-${String(count + 1).padStart(3, '0')}`;
}
