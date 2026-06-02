import { useCallback, useEffect, useRef, useState } from "react";
import type { PoemAnalysis, PoemComparison } from "@/workshop/analysis/ai-analyze";
import { parseAiErrorAndNotify } from "@/workshop/ai-cost/aiBudgetBus";
import { loadChat, saveChat } from "./ai-analysis-helpers";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function AiChat({
  title,
  lines,
  result,
  poemId,
}: {
  title: string;
  lines: string[];
  result: PoemAnalysis | PoemComparison;
  poemId?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(poemId));
  const [input, setInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "loading" | "error">("idle");
  const [chatError, setChatError] = useState("");

  // Persist chat per poem.
  useEffect(() => { saveChat(poemId, messages); }, [poemId, messages]);
  // When poemId changes, reload that poem's saved messages.
  const lastPoemRef = useRef(poemId);
  useEffect(() => {
    if (lastPoemRef.current !== poemId) {
      lastPoemRef.current = poemId;
      setMessages(loadChat(poemId));
    }
  }, [poemId]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const analysisContext = (() => {
    const parts: string[] = [`Overall score: ${result.overall_score}/100`];
    if (result.summary) parts.push(`Summary: ${result.summary}`);
    if (result.issues.length > 0) {
      parts.push(`Issues (${result.issues.length}): ${result.issues.slice(0, 3).map((i) => i.rationale.slice(0, 60)).join("; ")}`);
    }
    return parts.join("\n");
  })();

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || chatStatus === "loading") return;
    const priorHistory = messages.map((m) => ({ role: m.role, content: m.text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setChatStatus("loading");
    setChatError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, lines, message: text, analysisContext, history: priorHistory }),
      });
      if (!res.ok) {
        const { message } = await parseAiErrorAndNotify(res, "chat");
        throw new Error(message);
      }
      const data = (await res.json()) as { reply?: string };
      const reply = data.reply ?? "No response.";
      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      setChatStatus("idle");
      setTimeout(() => {
        listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
      }, 50);
    } catch (err) {
      setChatError((err as Error).message);
      setChatStatus("error");
    }
  }, [chatStatus, messages, title, lines, analysisContext]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || chatStatus === "loading") return;
    setInput("");
    void sendMessage(text);
  }, [input, chatStatus, sendMessage]);

  const SUGGESTED_PROMPTS = [
    "What's the strongest image here?",
    "How can I sharpen the ending?",
    "Where is the rhythm uneven?",
    "Suggest a different title.",
  ];

  return (
    <div className="ai-chat">
      <div className="ai-chat-header">
        <span className="ai-chat-title">
          <span className="ai-chat-title-icon" aria-hidden>✦</span>
          Ask about your poem
        </span>
        <span className="ai-chat-hint">The AI knows your poem and the feedback above.</span>
      </div>

      {messages.length === 0 && chatStatus !== "loading" && (
        <div className="ai-chat-empty">
          <div className="ai-chat-empty-bubble" aria-hidden>✦</div>
          <p className="ai-chat-empty-greeting">
            Ask anything about your poem — voice, craft, a stuck line.
          </p>
          <div className="ai-chat-suggestions">
            <span className="ai-chat-suggestions-label">Try asking</span>
            <div className="ai-chat-suggestions-chips">
              {SUGGESTED_PROMPTS.map((p, i) => (
                <button key={i} type="button" className="ai-chat-suggestion-chip"
                  onClick={() => void sendMessage(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {messages.length > 0 && (
        <div className="ai-chat-messages" ref={listRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`ai-chat-msg ai-chat-msg-${msg.role}`}>
              <span className="ai-chat-msg-role">{msg.role === "user" ? "You" : "AI"}</span>
              <span className="ai-chat-msg-text">{msg.text}</span>
            </div>
          ))}
          {chatStatus === "loading" && (
            <div className="ai-chat-msg ai-chat-msg-assistant ai-chat-msg-loading">
              <span className="ai-chat-msg-role">AI</span>
              <span className="ai-chat-dot" /><span className="ai-chat-dot" /><span className="ai-chat-dot" />
            </div>
          )}
        </div>
      )}

      {chatStatus === "error" && (
        <p className="ai-chat-error" role="alert">{chatError}</p>
      )}

      <div className="ai-chat-input-row">
        <textarea
          ref={inputRef}
          className="ai-chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your poem or the feedback…"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          onFocus={() => {
            // After the keyboard opens and the viewport shrinks, scroll the
            // input into view so it isn't hidden under the keyboard.
            setTimeout(() => {
              inputRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }, 350);
          }}
        />
        <button
          type="button"
          className="ai-chat-send-btn"
          onClick={() => void handleSend()}
          disabled={!input.trim() || chatStatus === "loading"}
          aria-label="Send message"
          title="Send (Enter)"
        >
          {chatStatus === "loading" ? (
            <span className="ai-chat-send-spin" aria-hidden>
              <span className="ai-chat-dot" /><span className="ai-chat-dot" /><span className="ai-chat-dot" />
            </span>
          ) : (
            <svg className="ai-chat-send-icon" viewBox="0 0 20 20" aria-hidden width="18" height="18">
              <path d="M2 10 L18 3 L11 18 L9 12 Z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>
      <p className="ai-chat-enter-hint muted small">
        <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> new line
      </p>
    </div>
  );
}
