import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Page } from '../../data/page';
import { t } from '../../i18n';

type Shown<T> = {
  first: Page<T>;
  rows: T[];
  next: number;
  more: boolean;
  loading: boolean;
  failed: boolean;
};

export type RowRef = (id: string) => (node: HTMLElement | null) => void;

type Props<T> = {
  first: Page<T>;
  fetchPage: (from: number) => Promise<Page<T>>;
  children: (rows: T[], rowRef: RowRef) => ReactNode;
};

export function PagedList<T extends { id: string }>({ first, fetchPage, children }: Props<T>) {
  const [state, setState] = useState<Shown<T> | null>(null);
  const focusNext = useRef<string | null>(null);
  const currentFirst = useRef(first);

  useEffect(() => {
    currentFirst.current = first;
    focusNext.current = null;
  }, [first]);
  const shown: Shown<T> =
    state?.first === first
      ? state
      : {
          first,
          rows: first.rows,
          next: first.rows.length,
          more: first.more,
          loading: false,
          failed: false,
        };

  async function showMore() {
    if (shown.loading) return;
    setState({ ...shown, loading: true, failed: false });
    const update = (change: (current: Shown<T>) => Shown<T>) =>
      setState((current) => (current?.first === shown.first ? change(current) : current));
    try {
      const page = await fetchPage(shown.next);
      const known = new Set(shown.rows.map((row) => row.id));
      const added = page.rows.filter((row) => !known.has(row.id));
      if (currentFirst.current === shown.first) focusNext.current = added[0]?.id ?? null;
      update((current) => ({
        ...current,
        rows: [...current.rows, ...added],
        next: current.next + page.rows.length,
        more: page.more,
        loading: false,
      }));
    } catch (error) {
      console.warn('load failed', error);
      update((current) => ({ ...current, loading: false, failed: true }));
    }
  }

  const rowRef: RowRef = (id) => (node) => {
    if (node === null || focusNext.current !== id) return;
    focusNext.current = null;
    node.focus();
  };

  return (
    <>
      {children(shown.rows, rowRef)}
      {shown.failed && (
        <p role="alert" className="error">
          {t.common.loadFailed}
        </p>
      )}
      {shown.more && (
        <button
          type="button"
          className="button secondary"
          aria-disabled={shown.loading || undefined}
          onClick={() => void showMore()}
        >
          {shown.loading ? t.common.loading : t.common.showMore}
        </button>
      )}
    </>
  );
}
