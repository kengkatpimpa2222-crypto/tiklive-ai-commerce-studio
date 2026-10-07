import { useEffect, useState } from "react";

export function useHash(): string {
  const [h, setH] = useState(() => location.hash.replace(/^#/, "") || "/");
  useEffect(() => {
    const on = () => setH(location.hash.replace(/^#/, "") || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return h;
}
