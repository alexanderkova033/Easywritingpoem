import { useEffect, useState } from "react";

export function SessionTimer({ startTs }: { startTs: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.floor((Date.now() - startTs) / 60_000);
  if (mins < 1) return null;
  if (mins < 60) return <>{mins}m</>;
  return <>{Math.floor(mins / 60)}h {mins % 60}m</>;
}
