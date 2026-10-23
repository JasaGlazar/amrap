import { useCallback, useEffect, useRef, useState } from 'react';

export type Loaded<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

type Settled<T> = { load: () => Promise<T>; state: Loaded<T> };

export function useLoad<T>(load: () => Promise<T>): [Loaded<T>, () => void] {
  const [settled, setSettled] = useState<Settled<T> | null>(null);
  const [version, setVersion] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const run = ++latest.current;
    load().then(
      (data) => {
        if (run === latest.current) setSettled({ load, state: { status: 'ok', data } });
      },
      (error: unknown) => {
        console.warn('load failed', error);
        if (run === latest.current) setSettled({ load, state: { status: 'error' } });
      },
    );
  }, [load, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const state: Loaded<T> = settled?.load === load ? settled.state : { status: 'loading' };
  return [state, reload];
}
