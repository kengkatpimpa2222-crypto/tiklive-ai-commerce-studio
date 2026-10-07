import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useData<T>(path: string, fallback: T): [T, () => void, string | null] {
  const [data, setData] = useState<T>(fallback);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api<T>(path)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [path]);
  useEffect(reload, [reload]);
  return [data, reload, error];
}
