import { useEffect, useState } from "react";

export function SavedAgo({ ts }: { ts: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.hidden) return;
      tick((n) => n + 1);
    }, 15_000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return <>Saved</>;
  if (secs < 60) return <>Saved {secs}s ago</>;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return <>Saved {mins}m ago</>;
  return <>Saved {Math.floor(mins / 60)}h ago</>;
}
