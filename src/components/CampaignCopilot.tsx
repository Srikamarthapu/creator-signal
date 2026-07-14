import {
  Bot,
  Database,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { agentThreadStorageKey, readLocal, writeLocal } from "../lib/storage";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthProvider";
import type {
  CampaignAgentMessage,
  CampaignAgentResponse,
  ResearchSessionMeta
} from "../lib/types";

const starterPrompts = [
  "Who are the strongest fits and why?",
  "Compare the top three creator results.",
  "What evidence gaps should I verify?",
  "Build a three-creator shortlist for outreach."
];

function messageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storedMessages(sessionId: string) {
  return readLocal<CampaignAgentMessage[]>(agentThreadStorageKey(sessionId), []).filter(
    (message) => message?.role === "user" || message?.role === "assistant"
  );
}

export function CampaignCopilot({
  session,
  product,
  configured
}: {
  session: ResearchSessionMeta | null;
  product: string;
  configured: boolean;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CampaignAgentMessage[]>([]);
  const [suggestions, setSuggestions] = useState(starterPrompts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError("");
    setInput("");
    setSuggestions(starterPrompts);
    setMessages(session ? storedMessages(session.id) : []);
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    writeLocal(agentThreadStorageKey(session.id), messages.slice(-30));
  }, [messages, session]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 180);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const clearThread = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSuggestions(starterPrompts);
    setLoading(false);
    setError("");
    inputRef.current?.focus();
  };

  const sendMessage = async (content: string) => {
    const question = content.trim();
    if (!question || !session || loading) return;

    const userMessage: CampaignAgentMessage = {
      id: messageId(),
      role: "user",
      content: question,
      createdAt: new Date().toISOString()
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setSuggestions([]);
    setLoading(true);
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await apiFetch("/api/agent/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchSessionId: session.id,
          organizationId: auth.activeOrganization?.id,
          messages: nextMessages.slice(-16).map((message) => ({
            id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id) ? message.id : undefined,
            role: message.role,
            content: message.content
          }))
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "The campaign copilot could not answer this question.");
      const data = payload as CampaignAgentResponse;
      const assistantMessage: CampaignAgentMessage = {
        id: messageId(),
        role: "assistant",
        content: data.answer,
        citations: data.citations,
        toolsUsed: data.toolsUsed,
        providerUsed: data.providerUsed,
        model: data.model,
        note: data.note,
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, assistantMessage]);
      setSuggestions(data.suggestions.length ? data.suggestions : starterPrompts.slice(0, 3));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "The campaign copilot could not answer this question.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  };

  const ready = Boolean(session?.sourceCount);
  const buttonLabel = ready ? "Ask campaign copilot" : "Preparing research";

  return (
    <>
      <button
        ref={triggerRef}
        className="copilot-trigger"
        type="button"
        onClick={() => setOpen(true)}
        disabled={!ready}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="campaign-copilot"
      >
        {ready ? <MessageSquareText className="h-5 w-5" /> : <Loader2 className="h-5 w-5 animate-spin" />}
        <span>{buttonLabel}</span>
        {ready ? <small>{session?.sourceCount} sources</small> : null}
      </button>

      {open ? (
        <div className="copilot-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <aside
            id="campaign-copilot"
            className="copilot-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="campaign-copilot-title"
          >
            <header className="copilot-header">
              <div className="copilot-title-row">
                <span className="copilot-icon" aria-hidden="true">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="eyebrow">Research agent</p>
                  <h2 id="campaign-copilot-title">Campaign copilot</h2>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="ghost-icon-button" type="button" onClick={clearThread} aria-label="Clear campaign copilot conversation" title="Clear conversation">
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button className="ghost-icon-button" type="button" onClick={close} aria-label="Close campaign copilot">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="copilot-grounding-bar">
              <span><Database className="h-3.5 w-3.5" /> {session?.sourceCount || 0} current sources</span>
              <span><ShieldCheck className="h-3.5 w-3.5" /> Bright Data only</span>
              <span className={configured ? "copilot-provider-on" : ""}>
                <Sparkles className="h-3.5 w-3.5" /> {configured ? "GLM 5.2 ready" : "Source-only mode"}
              </span>
            </div>

            <div className="copilot-scroll" ref={scrollRef} aria-live="polite">
              {!messages.length ? (
                <div className="copilot-welcome">
                  <div className="copilot-welcome-icon"><MessageSquareText className="h-6 w-6" /></div>
                  <h3>Plan from the research you can see.</h3>
                  <p>
                    Ask about {product || "this search"}. I can compare current creators, inspect evidence, identify gaps, and build a shortlist. I will not answer from outside this research session.
                  </p>
                </div>
              ) : null}

              <div className="copilot-messages">
                {messages.map((message) => (
                  <article className={`copilot-message copilot-message-${message.role}`} key={message.id}>
                    <div className="copilot-message-label">
                      <span>{message.role === "user" ? "You" : "Copilot"}</span>
                      {message.role === "assistant" ? (
                        <small>{message.providerUsed ? "GLM 5.2" : "Source-only"}</small>
                      ) : null}
                    </div>
                    <p>{message.content}</p>
                    {message.toolsUsed?.length ? (
                      <div className="copilot-tool-trace" aria-label="Research tools used">
                        {message.toolsUsed.map((tool, index) => (
                          <span key={`${tool.name}-${index}`}><Database className="h-3 w-3" /> {tool.label}</span>
                        ))}
                      </div>
                    ) : null}
                    {message.citations?.length ? (
                      <div className="copilot-citations">
                        <strong>Evidence</strong>
                        {message.citations.map((citation) => (
                          <a href={citation.url} target="_blank" rel="noreferrer" key={citation.id}>
                            <span>{citation.id}</span>
                            <span className="min-w-0">
                              <b>{citation.creatorName || citation.title}</b>
                              <small>{citation.title}</small>
                            </span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        ))}
                      </div>
                    ) : null}
                    {message.note ? <small className="copilot-note">{message.note}</small> : null}
                  </article>
                ))}

                {loading ? (
                  <div className="copilot-thinking" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Searching this research and asking GLM 5.2...</span>
                  </div>
                ) : null}
              </div>

              {error ? (
                <div className="copilot-error" role="alert">
                  <p>{error}</p>
                  <button type="button" onClick={() => setError("")}>Dismiss</button>
                </div>
              ) : null}

              {suggestions.length && !loading ? (
                <div className="copilot-prompts" aria-label="Suggested questions">
                  {suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <form className="copilot-composer" onSubmit={submit}>
              <label htmlFor="campaign-copilot-input">Ask about this research</label>
              <div>
                <textarea
                  ref={inputRef}
                  id="campaign-copilot-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value.slice(0, 2400))}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Compare creators or plan an outreach angle..."
                  rows={2}
                  disabled={loading || !ready}
                />
                <button type="submit" disabled={!input.trim() || loading || !ready} aria-label="Send message">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p>Enter to send. Shift+Enter for a new line. Verify campaign facts at the linked source.</p>
            </form>
          </aside>
        </div>
      ) : null}
    </>
  );
}
