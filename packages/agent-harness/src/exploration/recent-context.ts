export function pushRecent(list: string[], value: string, limit = 8): void {
  list.push(value);
  while (list.length > limit) list.shift();
}
