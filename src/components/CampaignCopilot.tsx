import {
  Bot,
  BookmarkPlus,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  CloudUpload,
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
import { FormEvent, KeyboardEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { activeAgentConversationStorageKey, agentThreadStorageKey, readLocal, writeLocal } from "../lib/storage";
import { apiFetch } from "../lib/api";
import { useAuth } from "./AuthProvider";
import type {
  CampaignAgentAction,
  CampaignAgentMessage,
  CampaignAgentResponse,
  DiscoveryAgentResponse,
  ResearchSessionMeta,
  SavedAgentConversationResponse,
  SearchState
} from "../lib/types";

const groundedPrompts = [
  "Who are the strongest fits and why?",
  "Compare the top three creator results.",
  "What evidence gaps should I verify?",
  "Build a three-creator shortlist for outreach."
];

const discoveryPrompts = [
  "Find creators for a product launch.",
  "Help me define the right creator profile.",
  "I need creators who can drive sales."
];

const CampaignBriefWorkspace = lazy(() => import("./CampaignBriefWorkspace").then((module) => ({ default: module.CampaignBriefWorkspace })));

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
  initialMessages,
  product,
  configured,
  navigate,
  currentSearch,
  onStartSearch,
  researchLoading,
  researchError
}: {
  session: ResearchSessionMeta | null;
  initialMessages: CampaignAgentMessage[];
  product: string;
  configured: boolean;
  navigate: (path: string) => void;
  currentSearch: SearchState;
  onStartSearch: (search: SearchState, researchSessionId: string, conversationId: string) => void;
  researchLoading: boolean;
  researchError: string;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "brief">("chat");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CampaignAgentMessage[]>([]);
  const [suggestions, setSuggestions] = useState(discoveryPrompts);
  const [loading, setLoading] = useState(false);
  const [busyActionId, setBusyActionId] = useState("");
  const [error, setError] = useState("");
  const [memoryState, setMemoryState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [resumableResearchRunId, setResumableResearchRunId] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSearchIdRef = useRef("");
  const previousResearchLoadingRef = useRef(false);
  const conversationIdRef = useRef(session?.conversationId || messageId());

  useEffect(() => {
    abortRef.current?.abort();
    setLoading(false);
    setBusyActionId("");
    setError("");
    setInput("");
    setView("chat");
    if (pendingSearchIdRef.current && (!session || session.id === pendingSearchIdRef.current)) {
      if (session) {
        conversationIdRef.current = session.conversationId || conversationIdRef.current;
        setMemoryState(session.conversationId ? "saved" : "idle");
        setSuggestions(groundedPrompts);
      }
      return;
    }
    conversationIdRef.current = session?.conversationId || (session ? session.id : messageId());
    if (session) setResumableResearchRunId("");
    setMemoryState(session?.conversationId ? "saved" : "idle");
    setSuggestions(session?.sourceCount && session.creatorCount ? groundedPrompts : discoveryPrompts);
    setMessages(session ? (initialMessages.length ? initialMessages : storedMessages(session.id)) : []);
  }, [session?.conversationId, session?.id]);

  useEffect(() => {
    if (session || !auth.user || !auth.activeOrganization) return;
    const storageKey = activeAgentConversationStorageKey(auth.activeOrganization.id);
    const savedConversationId = readLocal<string>(storageKey, "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(savedConversationId)) return;
    let active = true;
    setMemoryState("saving");
    apiFetch(`/api/agent/conversations/${savedConversationId}?organizationId=${encodeURIComponent(auth.activeOrganization.id)}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "The saved agent conversation could not be opened.");
        return payload as SavedAgentConversationResponse;
      })
      .then((payload) => {
        if (!active) return;
        conversationIdRef.current = payload.conversation.id;
        setMessages(payload.conversation.messages.slice(-30));
        setResumableResearchRunId(payload.conversation.researchRunId || "");
        setSuggestions(payload.conversation.researchRunId ? groundedPrompts : discoveryPrompts.slice(1));
        setMemoryState("saved");
      })
      .catch(() => {
        if (!active) return;
        conversationIdRef.current = messageId();
        setMemoryState("idle");
      });
    return () => {
      active = false;
    };
  }, [auth.activeOrganization?.id, auth.user?.id, session?.id]);

  useEffect(() => {
    if (!session) return;
    writeLocal(agentThreadStorageKey(session.id), messages.slice(-30));
  }, [messages, session]);

  useEffect(() => {
    if (!session?.conversationId || !auth.activeOrganization) return;
    writeLocal(activeAgentConversationStorageKey(auth.activeOrganization.id), session.conversationId);
  }, [auth.activeOrganization?.id, session?.conversationId]);

  useEffect(() => {
    const openAgent = () => setOpen(true);
    window.addEventListener("creatorsignal:open-agent", openAgent);
    return () => window.removeEventListener("creatorsignal:open-agent", openAgent);
  }, []);

  useEffect(() => {
    const pendingSearchId = pendingSearchIdRef.current;
    const finished = previousResearchLoadingRef.current && !researchLoading;
    previousResearchLoadingRef.current = researchLoading;
    if (!pendingSearchId || !finished) return;

    if (session?.id === pendingSearchId && session.creatorCount > 0) {
      const completionId = `discovery-complete-${pendingSearchId}`;
      setMessages((current) => current.some((message) => message.id === completionId) ? current : [...current, {
        id: completionId,
        role: "assistant",
        content: `I found ${session.creatorCount} source-backed creator candidate${session.creatorCount === 1 ? "" : "s"}. I can now compare their evidence, surface risks, and help you choose the strongest fit.`,
        toolsUsed: [{ name: "search_research", label: `Loaded ${session.sourceCount} Bright Data evidence records` }],
        providerUsed: false,
        model: "z-ai/glm-5.2",
        note: "Creator recommendations are now restricted to this live research session.",
        createdAt: new Date().toISOString()
      }]);
      setSuggestions(groundedPrompts);
      pendingSearchIdRef.current = "";
      return;
    }

    if (researchError) {
      setError(researchError);
      setSuggestions(["Retry this creator search", ...discoveryPrompts.slice(1)]);
      pendingSearchIdRef.current = "";
      return;
    }

    const completionId = `discovery-empty-${pendingSearchId}`;
    setMessages((current) => current.some((message) => message.id === completionId) ? current : [...current, {
      id: completionId,
      role: "assistant",
      content: "The live search finished without enough usable public creator evidence. Tell me a preferred platform, niche, geography, or content format and I’ll reshape the search.",
      toolsUsed: [{ name: "find_creators", label: "No source-backed creator candidates returned" }],
      providerUsed: false,
      model: "z-ai/glm-5.2",
      note: "No local or invented creator profiles were substituted.",
      createdAt: new Date().toISOString()
    }]);
    setSuggestions(["Retry with YouTube reviewers", "Narrow the creator niche", "Search across every platform"]);
    pendingSearchIdRef.current = "";
  }, [researchError, researchLoading, session]);

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
  }, [messages, loading, open, researchLoading]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const close = () => {
    setOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const clearThread = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSuggestions(session?.sourceCount && session.creatorCount ? groundedPrompts : discoveryPrompts);
    setLoading(false);
    setBusyActionId("");
    setError("");
    setMemoryState("idle");
    conversationIdRef.current = messageId();
    setResumableResearchRunId("");
    if (auth.activeOrganization) {
      writeLocal(activeAgentConversationStorageKey(auth.activeOrganization.id), conversationIdRef.current);
    }
    inputRef.current?.focus();
  };

  const sendMessage = async (content: string) => {
    const question = content.trim();
    if (!question || loading || researchLoading) return;
    if (!auth.user || !auth.activeOrganization) {
      setError("Sign in to use the creator discovery agent and save its research.");
      return;
    }

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
    setMemoryState("saving");
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const groundedReady = Boolean(session?.sourceCount && session.creatorCount);
      const requestsNewSearch = /\b(?:new|another|different|more|redo|retry)\b.{0,40}\b(?:search|creators?|influencers?)\b|\b(?:search|find|discover)\b.{0,50}\b(?:creators?|influencers?)\b.{0,30}\b(?:for|about|instead)\b/i.test(question);
      if (!groundedReady || requestsNewSearch) {
        const response = await apiFetch("/api/agent/discovery", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: auth.activeOrganization.id,
            conversationId: conversationIdRef.current,
            currentSearch,
            messages: nextMessages.slice(-16).map((message) => ({
              id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(message.id) ? message.id : undefined,
              role: message.role,
              content: message.content
            }))
          })
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error || "The discovery agent could not plan this search.");
        const data = payload as DiscoveryAgentResponse;
        conversationIdRef.current = data.conversationId;
        writeLocal(activeAgentConversationStorageKey(auth.activeOrganization.id), data.conversationId);
        setMemoryState(data.workspacePersistence?.saved ? "saved" : "failed");
        const assistantMessage: CampaignAgentMessage = {
          id: data.workspacePersistence?.assistantMessageId || messageId(),
          role: "assistant",
          content: data.answer,
          toolsUsed: data.toolsUsed,
          providerUsed: data.providerUsed,
          model: data.model,
          note: data.note,
          createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, assistantMessage]);
        if (data.action === "search" && data.searchPlan) {
          const researchSessionId = messageId();
          pendingSearchIdRef.current = researchSessionId;
          previousResearchLoadingRef.current = false;
          setSuggestions([]);
          onStartSearch(data.searchPlan, researchSessionId, data.conversationId);
        } else {
          setSuggestions(discoveryPrompts.slice(1));
        }
        return;
      }

      const response = await apiFetch("/api/agent/chat", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          researchSessionId: session!.id,
          conversationId: conversationIdRef.current,
          organizationId: auth.activeOrganization.id,
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
      writeLocal(
        activeAgentConversationStorageKey(auth.activeOrganization.id),
        data.workspacePersistence?.conversationId || conversationIdRef.current
      );
      setMemoryState(data.workspacePersistence?.saved ? "saved" : "failed");
      const assistantMessage: CampaignAgentMessage = {
        id: data.workspacePersistence?.assistantMessageId || messageId(),
        role: "assistant",
        content: data.answer,
        citations: data.citations,
        actions: data.actions,
        toolsUsed: data.toolsUsed,
        providerUsed: data.providerUsed,
        model: data.model,
        note: data.note,
        createdAt: new Date().toISOString()
      };
      setMessages((current) => [...current, assistantMessage]);
      setSuggestions(data.suggestions.length ? data.suggestions : groundedPrompts.slice(0, 3));
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setMemoryState("failed");
      setError(requestError instanceof Error ? requestError.message : "The campaign copilot could not answer this question.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  };

  const updateMessageAction = (assistantMessageId: string, action: CampaignAgentAction) => {
    setMessages((current) => current.map((message) => message.id === assistantMessageId ? {
      ...message,
      actions: message.actions?.map((candidate) => candidate.id === action.id ? action : candidate)
    } : message));
  };

  const confirmAgentAction = async (assistantMessageId: string, action: CampaignAgentAction) => {
    if (!auth.user || !auth.activeOrganization || busyActionId) return;
    setBusyActionId(action.id);
    setError("");
    updateMessageAction(assistantMessageId, { ...action, status: "processing", error: undefined });
    try {
      const response = await apiFetch(`/api/agent/actions/${action.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: auth.activeOrganization.id,
          conversationId: conversationIdRef.current
        })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        if (payload?.action?.id === action.id) updateMessageAction(assistantMessageId, payload.action as CampaignAgentAction);
        throw new Error(payload?.error || "The creator could not be saved from this agent action.");
      }
      updateMessageAction(assistantMessageId, payload.action as CampaignAgentAction);
    } catch (actionError) {
      setMessages((current) => current.map((message) => message.id === assistantMessageId ? {
        ...message,
        actions: message.actions?.map((candidate) => candidate.id === action.id && candidate.status === "processing" ? {
          ...candidate,
          status: "failed",
          error: "The save did not finish. Retry when ready."
        } : candidate)
      } : message));
      setError(actionError instanceof Error ? actionError.message : "The creator could not be saved.");
    } finally {
      setBusyActionId("");
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

  const ready = Boolean(session?.sourceCount && session.creatorCount);
  const buttonLabel = researchLoading ? "Searching live sources" : ready ? "Ask discovery agent" : "Plan with AI agent";

  return (
    <>
      <button
        ref={triggerRef}
        className="copilot-trigger"
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="campaign-copilot"
      >
        {researchLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : ready ? <MessageSquareText className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        <span>{buttonLabel}</span>
        <small>{ready ? `${session?.sourceCount} sources` : researchLoading ? "Bright Data" : "Start here"}</small>
      </button>

      {open ? (
        <div className="copilot-layer" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <aside
            id="campaign-copilot"
            className={`copilot-panel ${view === "brief" ? "copilot-panel-brief" : ""}`}
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
                  <p className="eyebrow">AI creator strategist</p>
                  <h2 id="campaign-copilot-title">Creator discovery agent</h2>
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
              <span><Database className="h-3.5 w-3.5" /> {ready ? `${session?.sourceCount || 0} current sources` : "Campaign intake"}</span>
              <span><ShieldCheck className="h-3.5 w-3.5" /> {ready ? "Evidence grounded" : "Live search tool"}</span>
              <span className={configured ? "copilot-provider-on" : ""}>
                <Sparkles className="h-3.5 w-3.5" /> {configured ? "GLM 5.2 ready" : "Structured fallback"}
              </span>
              <span className={`copilot-memory-state copilot-memory-${memoryState}`}>
                {memoryState === "saving" ? <CloudUpload className="h-3.5 w-3.5" /> : memoryState === "failed" ? <CloudOff className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                {memoryState === "saving" ? "Saving" : memoryState === "failed" ? "Not saved" : memoryState === "saved" ? "Memory saved" : "Ready to save"}
              </span>
            </div>

            {ready ? <div className="copilot-view-tabs" role="tablist" aria-label="Creator discovery workspace">
              <button type="button" role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}>
                <MessageSquareText className="h-4 w-4" /> Chat
              </button>
              <button type="button" role="tab" aria-selected={view === "brief"} onClick={() => setView("brief")}>
                <ClipboardCheck className="h-4 w-4" /> Brief
              </button>
            </div> : null}

            <div className="copilot-scroll" ref={scrollRef} aria-live="polite">
              {view === "brief" ? (
                session ? (
                  <Suspense fallback={<div className="campaign-brief-loading"><Loader2 className="h-5 w-5 animate-spin" /> Opening campaign brief...</div>}>
                    <CampaignBriefWorkspace session={session} messages={messages} navigate={navigate} />
                  </Suspense>
                ) : null
              ) : (<>
              {!messages.length ? (
                <div className="copilot-welcome">
                  <div className="copilot-welcome-icon"><MessageSquareText className="h-6 w-6" /></div>
                  <h3>{ready ? "Choose from evidence, not guesswork." : "Tell me who you need to reach."}</h3>
                  <p>
                    {ready
                      ? `I can compare the current ${product || "creator"} results, inspect evidence, surface risks, and help build a shortlist without stepping outside this research session.`
                      : "Describe the product, audience, campaign goal, budget, and any creator preferences. I’ll shape the search, launch Bright Data, and then help you compare only the creators it actually returns."}
                  </p>
                </div>
              ) : null}

              {!auth.user || !auth.activeOrganization ? (
                <div className="copilot-auth-gate">
                  <ShieldCheck className="h-5 w-5" />
                  <div>
                    <strong>{auth.user ? "Opening your workspace" : "Sign in to start discovery"}</strong>
                    <p>{auth.user ? auth.error || "Creator searches need an active workspace." : "Your searches and agent decisions are saved to a private workspace."}</p>
                  </div>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={auth.workspaceLoading}
                    onClick={() => auth.user ? void auth.refreshWorkspace() : navigate("/auth")}
                  >
                    {auth.user ? auth.workspaceLoading ? "Opening..." : "Reload workspace" : "Sign in"}
                  </button>
                </div>
              ) : null}

              {!ready && resumableResearchRunId ? (
                <div className="copilot-resume-memory">
                  <Database className="h-5 w-5" />
                  <div>
                    <strong>Source-backed results are saved</strong>
                    <p>Resume the linked Bright Data research before asking the agent to compare creators.</p>
                  </div>
                  <button type="button" onClick={() => navigate(`/research/${resumableResearchRunId}`)}>Resume</button>
                </div>
              ) : null}

              <div className="copilot-messages">
                {messages.map((message) => (
                  <article className={`copilot-message copilot-message-${message.role}`} key={message.id}>
                    <div className="copilot-message-label">
                      <span>{message.role === "user" ? "You" : "Copilot"}</span>
                      {message.role === "assistant" ? (
                        <small>{message.providerUsed ? "GLM 5.2" : message.citations?.length ? "Source-only" : "Structured"}</small>
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
                    {message.actions?.length ? (
                      <div className="copilot-actions" aria-label="Shortlist actions">
                        <div className="copilot-actions-heading">
                          <strong>Shortlist actions</strong>
                          <small>Nothing changes until you confirm.</small>
                        </div>
                        {message.actions.map((action) => (
                          <div className={`copilot-action-row copilot-action-${action.status}`} key={action.id}>
                            <span className="copilot-action-icon" aria-hidden="true">
                              {action.status === "saved" ? <Check className="h-4 w-4" /> : <BookmarkPlus className="h-4 w-4" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <b>{action.creatorName}</b>
                              <small>{action.status === "saved" ? "Saved to your workspace shortlist" : action.status === "failed" ? action.error || "Save failed" : action.status === "processing" ? "Saving to shortlist..." : "Ready for your approval"}</small>
                            </span>
                            {action.status === "saved" && action.result?.shortlistId ? (
                              <button type="button" onClick={() => navigate(`/shortlist/${action.result?.shortlistId}`)}>
                                Open <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={action.status === "processing" || Boolean(busyActionId)}
                                onClick={() => void confirmAgentAction(message.id, action)}
                              >
                                {action.status === "processing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookmarkPlus className="h-3.5 w-3.5" />}
                                {action.status === "failed" ? "Retry save" : action.status === "processing" ? "Saving" : "Confirm save"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.note ? <small className="copilot-note">{message.note}</small> : null}
                  </article>
                ))}

                {loading || researchLoading ? (
                  <div className="copilot-thinking" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{researchLoading ? "Bright Data is finding real public creator evidence..." : ready ? "Searching this research and asking GLM 5.2..." : "Turning your requirements into a creator search..."}</span>
                  </div>
                ) : null}
              </div>

              {error ? (
                <div className="copilot-error" role="alert">
                  <p>{error}</p>
                  <button type="button" onClick={() => setError("")}>Dismiss</button>
                </div>
              ) : null}

              {suggestions.length && !loading && !researchLoading && auth.user ? (
                <div className="copilot-prompts" aria-label="Suggested questions">
                  {suggestions.map((suggestion) => (
                    <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
              </>)}
            </div>

            {view === "chat" && auth.user && auth.activeOrganization ? <form className="copilot-composer" onSubmit={submit}>
              <label htmlFor="campaign-copilot-input">{ready ? "Ask about these creators" : "Describe the creators you need"}</label>
              <div>
                <textarea
                  ref={inputRef}
                  id="campaign-copilot-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value.slice(0, 2400))}
                  onKeyDown={handleInputKeyDown}
                  placeholder={ready ? "Compare creators or refine the search..." : "We are launching a desk lamp for remote workers..."}
                  rows={2}
                  disabled={loading || researchLoading}
                />
                <button type="submit" disabled={!input.trim() || loading || researchLoading} aria-label="Send message">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
              <p>{ready ? "Recommendations stay tied to linked public evidence." : "The agent will ask only for details that improve discovery."}</p>
            </form> : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
