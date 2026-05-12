import { useEffect, useState } from "react";

const WRITING_PROMPTS = [
  "Try opening with a single concrete image.",
  "What does it sound like, smell like, feel like?",
  "Start with the last thing you noticed today.",
  "Who is speaking, and to whom?",
  "What are you circling around without saying directly?",
  "Begin in the middle of an action.",
  "What would the room say if it could speak?",
  "Name the thing you're afraid to name.",
  "What colour is the feeling?",
  "Write the line you've been putting off.",
];

export function WritingPrompt({ visible }: { visible: boolean }) {
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      setFading(true);
      const timer = setTimeout(() => {
        setIdx((i) => (i + 1) % WRITING_PROMPTS.length);
        setFading(false);
      }, 380);
      return () => clearTimeout(timer);
    }, 6000);
    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;
  return (
    <p className={`writing-prompt${fading ? " is-fading" : ""}`} aria-hidden>
      {WRITING_PROMPTS[idx]}
    </p>
  );
}
