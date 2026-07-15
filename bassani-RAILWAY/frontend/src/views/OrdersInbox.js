import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { stripEmailQuote } from "../utils/stripEmailQuote";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  Mail, AlertCircle, Paperclip, RefreshCw,
  ExternalLink, Send, Archive, Search, Loader2,
} from "lucide-react";
import { TopBar, BtnPrimary, BtnSecondary } from "../components/UI";

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { value: "open",     label: "Inbox"    },
  { value: "unhandled",label: "New"      },
  { value: "archived", label: "Archived" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SAST = { timeZone: "Africa/Johannesburg" };

function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", ...SAST });
}

function fmtListDate(d) {
  if (!d) return "";
  const dt  = new Date(d);
  const now = new Date();
  const toSASTMidnight = (date) => {
    const s = date.toLocaleDateString("en-ZA", { year: "numeric", month: "2-digit", day: "2-digit", ...SAST });
    return new Date(s.split("/").reverse().join("-") + "T00:00:00");
  };
  const today     = toSASTMidnight(now);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay    = toSASTMidnight(dt);
  if (msgDay.getTime() === today.getTime())     return fmtTime(dt);
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  if ((today - msgDay) / 86400000 < 7)          return dt.toLocaleDateString("en-ZA", { weekday: "short", ...SAST });
  return dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short", ...SAST });
}

function fmtMsgDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", ...SAST,
  });
}

function sameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth()    === db.getMonth()    &&
    da.getDate()     === db.getDate()
  );
}

// ── AttachmentList ────────────────────────────────────────────────────────────

function AttachmentList({ attachments, itemId }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/5">
      {attachments.map((att, i) => {
        const url = att.id
          ? `/api/orders-inbox/${itemId}/attachment/${att.id}`
          : att.imap_attachment_id
          ? `/api/orders-inbox/${itemId}/imap-attachment/${att.imap_attachment_id}`
          : null;
        const key = att.id || att.imap_attachment_id || i;
        if (!url) return (
          <span key={key}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-400 cursor-not-allowed"
            title="Attachment too large to store (over 15 MB)"
          >
            <Paperclip size={10} /> {att.name}
          </span>
        );
        return (
          <a key={key} href={url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Paperclip size={10} className="text-gray-400" />
            {att.name}
            {att.size_bytes > 0 && (
              <span className="text-gray-400 ml-0.5">({Math.round(att.size_bytes / 1024)}KB)</span>
            )}
            <ExternalLink size={9} className="text-gray-400" />
          </a>
        );
      })}
    </div>
  );
}

// ── ThreadRow ─────────────────────────────────────────────────────────────────

function ThreadRow({ thread, isSelected, onClick }) {
  const name   = thread.from_name || thread.from_email || "Unknown";
  const unread = thread.has_unread;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors ${
        isSelected
          ? "bg-bassani-50 border-l-2 border-l-bassani-400 pl-[14px]"
          : "hover:bg-gray-50/80 border-l-2 border-l-transparent"
      }`}
    >
      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-[9px] ${unread ? "bg-bassani-500" : "bg-transparent"}`} />
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
        unread ? "bg-bassani-100 text-bassani-700" : "bg-gray-100 text-gray-500"
      }`}>
        {initials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[13px] truncate ${unread ? "font-semibold text-gray-900" : "font-medium text-gray-600"}`}>
            {name}
          </span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtListDate(thread.received_at)}</span>
        </div>
        <div className={`text-[12px] truncate mt-0.5 ${unread ? "font-medium text-gray-800" : "text-gray-500"}`}>
          {thread.subject}
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className="text-[11px] text-gray-400 truncate">{thread.body_preview}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {thread.has_attachments && <Paperclip size={10} className="text-gray-300" />}
            {thread.message_count > 1 && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                {thread.message_count}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg, itemId }) {
  const isOut   = msg.is_outgoing;
  const name    = msg.from_name || msg.from_email || "Unknown";
  const bgClass = isOut ? "bg-teal-50 border-teal-100" : "bg-white border-gray-100";
  const avClass = isOut ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-600";
  const [showQuote, setShowQuote] = useState(false);

  const { body, hasQuote, quoteHtml } = useMemo(() => {
    if (isOut) return { body: msg.body_html || `<p style="margin:0">${msg.body_preview || ""}</p>`, hasQuote: false, quoteHtml: "" };
    return stripEmailQuote(msg.body_html || `<p style="margin:0">${msg.body_preview || ""}</p>`);
  }, [msg.body_html, msg.body_preview, isOut]);

  return (
    <div className={`flex gap-3 ${isOut ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-1 ${avClass}`}>
        {initials(name)}
      </div>
      <div className={`max-w-[78%] flex flex-col ${isOut ? "items-end" : "items-start"}`}>
        <div className={`flex items-center gap-2 mb-1 text-[11px] ${isOut ? "flex-row-reverse" : ""}`}>
          <span className="font-medium text-gray-700">{name}</span>
          <span className="text-gray-400">{fmtTime(msg.received_at)}</span>
          {isOut && <span className="text-teal-500 font-medium">Sent</span>}
        </div>
        <div
          className={`rounded-2xl border px-4 py-3 text-[13px] text-gray-700 leading-relaxed shadow-sm ${bgClass} ${
            isOut ? "rounded-tr-sm" : "rounded-tl-sm"
          }`}
          style={{ wordBreak: "break-word", overflow: "hidden" }}
        >
          <div dangerouslySetInnerHTML={{ __html: body }} />
          {hasQuote && (
            <>
              {showQuote && (
                <div
                  className="mt-3 pt-3 border-t border-gray-100 text-[12px] leading-relaxed text-gray-400"
                  dangerouslySetInnerHTML={{ __html: quoteHtml }}
                />
              )}
              <button
                onClick={() => setShowQuote(v => !v)}
                className="mt-2 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showQuote ? "Hide quoted text" : "···"}
              </button>
            </>
          )}
          <AttachmentList attachments={msg.attachments} itemId={itemId} />
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OrdersInbox() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const bottomRef = useRef(null);

  const [threads,         setThreads        ] = useState([]);
  const [total,           setTotal          ] = useState(0);
  const [loading,         setLoading        ] = useState(true);
  const [configured,      setConfigured     ] = useState(true);
  const [mailboxAddress,  setMailboxAddress ] = useState("");
  const [statusFilter,    setStatusFilter   ] = useState("open");
  const [search,          setSearch         ] = useState("");
  const [searchDraft,     setSearchDraft    ] = useState("");

  const [selectedThread,  setSelectedThread ] = useState(null);
  const [messages,        setMessages       ] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [replyText,    setReplyText   ] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [archiving,    setArchiving   ] = useState(false);

  // ── Load thread list ─────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: statusFilter };
      if (search) params.q = search;
      const r = await api.get("/api/orders-inbox", { params });
      if (r.data.configured === false) {
        setConfigured(false);
        setThreads([]);
      } else {
        setConfigured(true);
        setThreads(r.data.items || []);
        setTotal(r.data.total || 0);
        if (r.data.mailbox_address) setMailboxAddress(r.data.mailbox_address);
      }
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { loadList(); }, [loadList]);

  const silentLoadList = useCallback(async () => {
    try {
      const params = { status: statusFilter };
      if (search) params.q = search;
      const r = await api.get("/api/orders-inbox", { params });
      if (r.data.configured !== false) {
        setThreads(r.data.items || []);
        setTotal(r.data.total || 0);
      }
    } catch { /* silent */ }
  }, [statusFilter, search]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") silentLoadList();
    }, 30_000);
    return () => clearInterval(id);
  }, [silentLoadList]);

  const selectedThreadId = selectedThread?.id;
  useEffect(() => {
    if (!selectedThreadId) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api.get(`/api/orders-inbox/${selectedThreadId}/thread`);
        const incoming = r.data.thread || [];
        setMessages(prev => {
          if (incoming.length !== prev.length) {
            setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
          }
          return incoming;
        });
      } catch { /* silent */ }
    }, 15_000);
    return () => clearInterval(id);
  }, [selectedThreadId]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchDraft), 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  }, [messages]);

  // ── Open thread ──────────────────────────────────────────────────────────────

  const openThread = async (thread) => {
    setSelectedThread(thread);
    setMessagesLoading(true);
    setMessages([]);
    setReplyText("");
    try {
      const r = await api.get(`/api/orders-inbox/${thread.id}/thread`);
      setMessages(r.data.thread || []);
      setThreads(prev =>
        prev.map(t => t.id === thread.id ? { ...t, has_unread: false, unread_count: 0 } : t)
      );
    } catch {
      toast.error("Failed to load thread");
    } finally {
      setMessagesLoading(false);
    }
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleSendReply = async () => {
    if (!selectedThread || !replyText.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/api/orders-inbox/${selectedThread.id}/reply`, {
        body_html: `<p>${replyText.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`,
      });
      toast.success("Reply sent");
      setReplyText("");
      const r = await api.get(`/api/orders-inbox/${selectedThread.id}/thread`);
      setMessages(r.data.thread || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleArchive = async () => {
    if (!selectedThread) return;
    setArchiving(true);
    try {
      await api.post(`/api/orders-inbox/${selectedThread.id}/archive`);
      toast.success("Archived");
      setThreads(prev => prev.filter(t => t.id !== selectedThread.id));
      setSelectedThread(null);
      setMessages([]);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to archive");
    } finally {
      setArchiving(false);
    }
  };

  const handlePoll = async () => {
    try {
      const r = await api.post("/api/orders-inbox/poll");
      toast.success(`Syncing — ${r.data.queued} message(s) queued`);
      setTimeout(loadList, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed");
    }
  };

  // ── Permission guard ─────────────────────────────────────────────────────────

  if (!can("orders_inbox.view")) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-center p-8">
        <Mail size={36} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-600">Access restricted</p>
        <p className="text-xs text-gray-400 mt-1">Ask a super admin to grant the orders_inbox.view permission.</p>
      </div>
    );
  }

  // ── Not configured ───────────────────────────────────────────────────────────

  if (!configured) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar title="Orders Inbox" subtitle="Shared mailbox" />
        <main className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <div className="w-16 h-16 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mail size={28} className="text-amber-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Orders Inbox not connected</h2>
            {can("settings.manage") ? (
              <>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  Connect a mailbox in Settings to activate the Orders Inbox for all orders staff.
                </p>
                <button
                  onClick={() => navigate("/settings/mailbox")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-bassani-600 text-white text-sm font-semibold rounded-xl hover:bg-bassani-700 transition-colors"
                >
                  <Mail size={14} /> Connect Mailbox
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 leading-relaxed">
                The orders inbox has not been configured. Ask your system administrator to connect a mailbox.
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  const canArchive = selectedThread != null && selectedThread.status !== "archived";

  // ── Two-panel layout ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Orders Inbox"
        subtitle={mailboxAddress ? `${mailboxAddress} · ${total} thread${total !== 1 ? "s" : ""}` : `${total} thread${total !== 1 ? "s" : ""}`}
        actions={
          <button
            onClick={handlePoll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          >
            <RefreshCw size={11} /> Sync
          </button>
        }
      />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Left panel ───────────────────────────────────────────────────── */}
        <div className="w-80 xl:w-[340px] flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden bg-white">

          <div className="px-3 py-2.5 border-b border-gray-100">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder="Search sender or subject…"
                className="w-full pl-7 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg outline-none focus:border-bassani-300 focus:ring-1 focus:ring-bassani-100 placeholder-gray-400"
              />
            </div>
          </div>

          <div className="flex border-b border-gray-100 overflow-x-auto flex-shrink-0">
            {TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => {
                  setStatusFilter(tab.value);
                  setSelectedThread(null);
                  setMessages([]);
                }}
                className={`px-3 py-2 text-[11px] font-semibold border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                  statusFilter === tab.value
                    ? "border-bassani-500 text-bassani-600"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={16} className="animate-spin text-gray-300" />
              </div>
            )}
            {!loading && threads.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <Mail size={20} className="text-gray-200 mb-2" />
                <p className="text-xs text-gray-400">
                  {search ? "No results" : "No threads"}
                </p>
              </div>
            )}
            {!loading && threads.map(thread => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                isSelected={selectedThread?.id === thread.id}
                onClick={() => openThread(thread)}
              />
            ))}
          </div>
        </div>

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50">

          {!selectedThread && !messagesLoading && (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <Mail size={28} className="text-gray-200" />
              <p className="text-sm text-gray-400">Select a thread to read</p>
            </div>
          )}

          {messagesLoading && !selectedThread && (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-gray-300" />
            </div>
          )}

          {selectedThread && (
            <>
              {/* Thread header */}
              <div className="flex-shrink-0 bg-white border-b border-gray-100 px-6 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-gray-900 truncate">
                      {selectedThread.subject}
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {selectedThread.from_name
                        ? `${selectedThread.from_name} · ${selectedThread.from_email}`
                        : selectedThread.from_email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canArchive && (
                      <BtnSecondary onClick={handleArchive} disabled={archiving} title="Archive this thread">
                        {archiving ? <Loader2 size={13} className="animate-spin" /> : <Archive size={13} />}
                        Archive
                      </BtnSecondary>
                    )}
                  </div>
                </div>
                {selectedThread.is_unknown_sender && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
                    <AlertCircle size={13} className="shrink-0" />
                    Sender is not a known contact.
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {messagesLoading && (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 size={16} className="animate-spin text-gray-300" />
                  </div>
                )}
                {!messagesLoading && messages.map((msg, i) => {
                  const prev = messages[i - 1];
                  const showDate = i === 0 || !sameDay(msg.received_at, prev?.received_at);
                  return (
                    <div key={msg.id}>
                      {showDate && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 border-t border-gray-100" />
                          <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                            {fmtMsgDate(msg.received_at)}
                          </span>
                          <div className="flex-1 border-t border-gray-100" />
                        </div>
                      )}
                      <MessageBubble msg={msg} itemId={selectedThread.id} />
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Reply box */}
              {selectedThread.status !== "archived" && (
                <div className="flex-shrink-0 bg-white border-t border-gray-100 px-6 py-4">
                  <textarea
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendReply();
                    }}
                    placeholder="Write a reply…"
                    rows={3}
                    className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 resize-none outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 placeholder-gray-400 transition-all"
                  />
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="text-[11px] text-gray-400">Ctrl/Cmd + Enter to send</span>
                    <BtnPrimary
                      onClick={handleSendReply}
                      disabled={sendingReply || !replyText.trim()}
                    >
                      {sendingReply ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Send reply
                    </BtnPrimary>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
