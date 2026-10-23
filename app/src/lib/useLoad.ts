import { useCallback, useEffect, useRef, useState } from 'react';

export type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

type Settled<T> = { load: () => Promise<T>; state: Loaded<T> };

export function useLoad<T>(load: () => Promise<T>): [Loaded<T>, () => Promise<void>] {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);
  const waiting = useRef<(() => void)[]>([]);

  useEffect(() => {
    const run = ++latest.current;
    const finish = (state: Loaded<T>) => {
      if (run !== latest.current) return;
      setSettled({ load, state });
      waiting.current.splice(0).forEach((resolve) => resolve());
    };
    load().then(
      (data) => finish({ status: 'ok', data }),
      (error: unknown) => {
        console.warn('load failed', error);
        finish({ status: 'error' });
      },
    );
  }, [load, version]);

  const reload = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setVersion((value) => value + 1);
      }),
    [],
  );
  const state: Loaded<T> = settled?.load === load ? settled.state : { status: 'loading' };
  return [state, reload];
}
