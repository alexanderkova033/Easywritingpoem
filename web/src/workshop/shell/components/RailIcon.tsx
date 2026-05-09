import type { ReactNode } from "react";

export function RailIcon({ children }: { children: ReactNode }) {
  return (
    <span className="workshop-rail-icon" aria-hidden>
      {children}
    </span>
  );
}
