export const PAGE_SIZE = 10;

export type Page<T> = { rows: T[]; more: boolean };

export function pageRange(from: number): [number, number] {
  return [from, from + PAGE_SIZE];
}

export function toPage<T>(rows: T[]): Page<T> {
  return { rows: rows.slice(0, PAGE_SIZE), more: rows.length > PAGE_SIZE };
}
