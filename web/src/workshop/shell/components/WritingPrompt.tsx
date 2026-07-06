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
  "Describe a place you can't go back to.",
  "What's the smallest detail that changed everything?",
  "Write to someone who will never read this.",
  "Start with a lie, then tell the truth underneath it.",
  "What does silence sound like right now?",
  "Borrow the first line from a memory.",
  "Write it as if explaining to a child.",
  "What are you holding onto that you should let go of?",
  "Pick an object nearby and let it speak.",
  "What happened right before this moment?",
  "Write the apology you never gave.",
  "What does your body remember?",
  "Turn a weather report into a feeling.",
  "What would you say if no one was listening?",
  "Start with a question you can't answer.",
  "Describe the last time you felt free.",
  "What does home smell like?",
  "Write about waiting for something.",
  "What's the shape of your longing?",
  "End before you're ready to.",
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
