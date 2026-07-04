import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  Mail, AlertCircle, Paperclip, User, RefreshCw,
  ExternalLink, Send, Archive, UserPlus, Ticket,
  CheckCircle2, Search, Loader2,
} from "lucide-react";
import {
  TopBar, Badge, BtnPrimary, BtnSecondary,
  Modal, FormGroup, Input,
} from "../components/UI";

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { value: "open",               label: "Inbox"    },
  { value: "unhandled",          label: "New"      },
  { value: "pending_onboarding", label: "Pending"  },
  { value: "ticket_created",     label: "Done"     },
  { value: "archived",           label: "Archived" },
];

const STATUS_META = {
  unhandled:          { label: "New",                color: "red"    },
  reply:              { label: "Reply",              color: "blue"   },
  pending_onboarding: { label: "Pending Onboarding", color: "amber"  },
  ticket_created:     { label: "Ticket Created",     color: "green"  },
  archived:           { label: "Archived",           color: "gray"   },
  sent:               { label: "Sent",               color: "teal"   },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function fmtListDate(d) {
  if (!d) return "";
  const dt        = new Date(d);
  const now       = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const msgDay    = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  if (msgDay.getTime() === today.getTime())     return fmtTime(dt);
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  if ((today - msgDay) / 86400000 < 7)          return dt.toLocaleDateString("en-ZA", { weekday: "short" });
  return dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function fmtMsgDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-ZA", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
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

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: "gray" };
  return <Badge color={m.color}>{m.label}</Badge>;
}

// ── AttachmentList ────────────────────────────────────────────────────────────

function AttachmentList({ attachments, itemId }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/5">
      {attachments.map((att, i) => {
        const url = att.id
          ? `/api/inbox/${itemId}/attachment/${att.id}`
          : att.imap_attachment_id
          ? `/api/inbox/${itemId}/imap-attachment/${att.imap_attachment_id}`
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

function ThreadStatusPill({ thread, onTicketClick }) {
  if (thread.ticket_id) return (
    <button
      onClick={e => { e.stopPropagation(); onTicketClick(thread.ticket_id); }}
      className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-50 text-green-700 border border-green-100 rounded px-1.5 py-0.5 hover:bg-green-100 transition-colors flex-shrink-0"
    >
      <Ticket size={9} /> Ticket
    </button>
  );
  if (thread.is_unknown_sender) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <AlertCircle size={9} /> Unknown
    </span>
  );
  if (thread.status === "pending_onboarding") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 rounded px-1.5 py-0.5 flex-shrink-0">
      Pending
    </span>
  );
  return null;
}

function ThreadRow({ thread, isSelected, onClick, onTicketClick }) {
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
      {/* Unread dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-[9px] ${unread ? "bg-bassani-500" : "bg-transparent"}`} />
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
        unread ? "bg-bassani-100 text-bassani-700" : "bg-gray-100 text-gray-500"
      }`}>
        {initials(name)}
      </div>
      {/* Content */}
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
            <ThreadStatusPill thread={thread} onTicketClick={onTicketClick} />
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
          <div dangerouslySetInnerHTML={{ __html: msg.body_html || `<p style="margin:0">${msg.body_preview || ""}</p>` }} />
          <AttachmentList attachments={msg.attachments} itemId={itemId} />
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SalesInbox() {
  const { can, user } = useAuth();
  const navigate      = useNavigate();
  const bottomRef     = useRef(null);

  // List
  const [threads,      setThreads     ] = useState([]);
  const [total,        setTotal       ] = useState(0);
  const [loading,      setLoading     ] = useState(true);
  const [configured,   setConfigured  ] = useState(true);
  const [statusFilter, setStatusFilter] = useState("open");
  const [search,       setSearch      ] = useState("");
  const [searchDraft,  setSearchDraft ] = useState("");

  // Thread detail
  const [selectedThread,  setSelectedThread ] = useState(null);
  const [messages,        setMessages       ] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  // Reply
  const [replyText,    setReplyText   ] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  // Link-customer modal
  const [linkOpen,      setLinkOpen     ] = useState(false);
  const [custSearch,    setCustSearch   ] = useState("");
  const [custResults,   setCustResults  ] = useState([]);
  const [custSearching, setCustSearching] = useState(false);
  const [linking,       setLinking      ] = useState(false);

  // Onboarding modal
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardNote, setOnboardNote] = useState("");
  const [onboarding,  setOnboarding ] = useState(false);

  // Action states
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [archiving,      setArchiving     ] = useState(false);

  // ── Load thread list ─────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = { status: statusFilter };
      if (search) params.q = search;
      const r = await api.get("/api/inbox", { params });
      if (r.data.configured === false) {
        setConfigured(false);
        setThreads([]);
      } else {
        setConfigured(true);
        setThreads(r.data.items || []);
        setTotal(r.data.total || 0);
      }
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { loadList(); }, [loadList]);

  // Debounce search input → committed search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchDraft), 400);
    return () => clearTimeout(t);
  }, [searchDraft]);

  // Scroll to latest message when thread loads
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
      const r = await api.get(`/api/inbox/${thread.id}/thread`);
      setMessages(r.data.thread || []);
      // Optimistic: mark thread read in list immediately
      setThreads(prev =>
        prev.map(t => t.id === thread.id ? { ...t, has_unread: false, unread_count: 0 } : t)
      );
    } catch {
      toast.error("Failed to load thread");
    } finally {
      setMessagesLoading(false);
    }
  };

  // ── Customer search (link modal) ─────────────────────────────────────────────

  useEffect(() => {
    if (!linkOpen) { setCustSearch(""); setCustResults([]); return; }
    if (!custSearch.trim()) { setCustResults([]); return; }
    setCustSearching(true);
    const t = setTimeout(() => {
      api.get("/api/customers/search", { params: { q: custSearch, limit: 8 } })
        .then(r => setCustResults(r.data.customers || []))
        .catch(() => setCustResults([]))
        .finally(() => setCustSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch, linkOpen]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleSendReply = async () => {
    if (!selectedThread || !replyText.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/api/inbox/${selectedThread.id}/reply`, {
        body_html: `<p>${replyText.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>")}</p>`,
      });
      toast.success("Reply sent");
      setReplyText("");
      const r = await api.get(`/api/inbox/${selectedThread.id}/thread`);
      setMessages(r.data.thread || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleCreateTicket = async () => {
    if (!selectedThread) return;
    setCreatingTicket(true);
    try {
      const r = await api.post(`/api/inbox/${selectedThread.id}/create-ticket`);
      toast.success("Sales ticket created");
      const updated = { ...selectedThread, ticket_id: r.data.ticket_id, status: "ticket_created" };
      setSelectedThread(updated);
      setThreads(prev =>
        ["open", "unhandled"].includes(statusFilter)
          ? prev.filter(t => t.id !== selectedThread.id)
          : prev.map(t => t.id === selectedThread.id ? updated : t)
      );
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleLinkCustomer = async (customerId, customerName) => {
    if (!selectedThread) return;
    setLinking(true);
    try {
      await api.post(`/api/inbox/${selectedThread.id}/link-customer`, { customer_id: customerId });
      toast.success(`Linked to ${customerName}`);
      const updated = { ...selectedThread, customer_id: customerId, customer_name: customerName, is_unknown_sender: false };
      setSelectedThread(updated);
      setThreads(prev => prev.map(t => t.id === selectedThread.id ? updated : t));
      setLinkOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link customer");
    } finally {
      setLinking(false);
    }
  };

  const handleStartOnboarding = async () => {
    if (!selectedThread) return;
    setOnboarding(true);
    try {
      await api.post(`/api/inbox/${selectedThread.id}/start-onboarding`, { note: onboardNote });
      toast.success("Flagged for onboarding");
      const updated = { ...selectedThread, status: "pending_onboarding" };
      setSelectedThread(updated);
      setThreads(prev => prev.map(t => t.id === selectedThread.id ? updated : t));
      setOnboardOpen(false);
      setOnboardNote("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to flag for onboarding");
    } finally {
      setOnboarding(false);
    }
  };

  const handleArchive = async () => {
    if (!selectedThread) return;
    setArchiving(true);
    try {
      await api.post(`/api/inbox/${selectedThread.id}/archive`);
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
      const r = await api.post("/api/inbox/poll");
      toast.success(`Syncing — ${r.data.queued} message(s) queued`);
      setTimeout(loadList, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sync failed");
    }
  };

  const goToTicket = (ticketId) => {
    navigate("/tickets/sales", { state: { openTicketId: ticketId } });
  };

  // ── Permission guard ─────────────────────────────────────────────────────────

  if (!can("inbox.view")) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center text-center p-8">
        <Mail size={36} className="text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-600">Access restricted</p>
        <p className="text-xs text-gray-400 mt-1">Ask a super admin to grant the inbox.view permission.</p>
      </div>
    );
  }

  // ── Not configured ───────────────────────────────────────────────────────────

  if (!configured) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar title="Sales Inbox" subtitle="Shared mailbox" />
        <main className="flex-1 overflow-y-auto flex items-center justify-center p-8">
          <div className="max-w-sm text-center">
            <div className="w-16 h-16 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mail size={28} className="text-amber-400" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Sales Inbox not connected</h2>
            {user?.is_super_admin ? (
              <>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  Connect an IMAP mailbox in Settings to activate the inbox for all staff.
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
                The sales inbox has not been configured. Ask your system administrator to connect a mailbox.
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Derived values for action bar ────────────────────────────────────────────

  // The conversation root is the earliest non-outgoing, non-reply message
  const isUnknown       = selectedThread?.is_unknown_sender;
  const ticketId        = selectedThread?.ticket_id;
  const canCreateTicket = selectedThread != null && !isUnknown && !ticketId;
  const canArchive      = selectedThread != null && selectedThread.status !== "archived";

  // ── Two-panel layout ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Sales Inbox"
        subtitle={`${total} thread${total !== 1 ? "s" : ""}`}
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

        {/* ── Left panel — thread list ─────────────────────────────────────── */}
        <div className="w-80 xl:w-[340px] flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden bg-white">

          {/* Search */}
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

          {/* Status tabs */}
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

          {/* Thread rows */}
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
                onTicketClick={goToTicket}
              />
            ))}
          </div>
        </div>

        {/* ── Right panel — thread detail ──────────────────────────────────── */}
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
                      <span className="font-medium text-gray-600">{selectedThread.from_name}</span>
                      {selectedThread.from_email && (
                        <span className="ml-1">&lt;{selectedThread.from_email}&gt;</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusBadge status={selectedThread.status} />
                    {ticketId && (
                      <button
                        onClick={() => goToTicket(ticketId)}
                        className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-lg px-2 py-0.5 font-medium hover:bg-green-100 transition-colors"
                      >
                        <CheckCircle2 size={10} className="text-green-500" /> View Ticket
                      </button>
                    )}
                  </div>
                </div>

                {/* Customer status indicator */}
                {!isUnknown && selectedThread.customer_name && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-green-600">
                    <CheckCircle2 size={10} className="text-green-500" />
                    {selectedThread.customer_name}
                  </div>
                )}
                {isUnknown && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600">
                    <AlertCircle size={10} className="text-amber-400" />
                    Unknown sender — link to a customer to create a ticket
                  </div>
                )}

                {/* Action bar */}
                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {isUnknown && (
                    <>
                      <button
                        onClick={() => setLinkOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <User size={11} /> Link customer
                      </button>
                      <button
                        onClick={() => setOnboardOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <UserPlus size={11} /> Start onboarding
                      </button>
                    </>
                  )}
                  {canCreateTicket && (
                    <button
                      onClick={handleCreateTicket}
                      disabled={creatingTicket}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-bassani-600 text-white rounded-lg hover:bg-bassani-700 transition-colors disabled:opacity-60"
                    >
                      <Ticket size={11} />
                      {creatingTicket ? "Creating…" : "Create ticket"}
                    </button>
                  )}
                  {canArchive && (
                    <button
                      onClick={handleArchive}
                      disabled={archiving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      <Archive size={11} />
                      {archiving ? "Dismissing…" : ticketId ? "Dismiss" : "Archive"}
                    </button>
                  )}
                </div>
              </div>

              {/* Message stream */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
                {messagesLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={16} className="animate-spin text-gray-300" />
                  </div>
                )}
                {!messagesLoading && messages.map((msg, idx) => {
                  const prev    = messages[idx - 1];
                  const showSep = !prev || !sameDay(prev.received_at, msg.received_at);
                  return (
                    <div key={msg.id || idx}>
                      {showSep && (
                        <div className="flex items-center gap-3 my-1">
                          <div className="flex-1 border-t border-gray-100" />
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">
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

              {/* Reply compose */}
              <div className="flex-shrink-0 bg-white border-t border-gray-100 px-4 py-3">
                <p className="text-[11px] text-gray-400 mb-1.5">
                  Replying to{" "}
                  <span className="font-medium text-gray-600">{selectedThread.from_email}</span>
                </p>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your reply…"
                  rows={3}
                  onKeyDown={e => {
                    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && replyText.trim()) {
                      handleSendReply();
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 resize-none placeholder-gray-400"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-[10px] text-gray-400">Ctrl+Enter to send</span>
                  <button
                    onClick={handleSendReply}
                    disabled={sendingReply || !replyText.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-bassani-600 text-white rounded-lg hover:bg-bassani-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sendingReply ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                    {sendingReply ? "Sending…" : "Send Reply"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Link customer modal ──────────────────────────────────────────────── */}
      {linkOpen && (
        <Modal title="Link to existing customer" onClose={() => setLinkOpen(false)} width="max-w-md">
          <p className="text-sm text-gray-500 mb-4">
            Search for the customer record that matches this sender. Once linked you can create a sales ticket.
          </p>
          <FormGroup label="Search customers">
            <Input
              value={custSearch}
              onChange={e => setCustSearch(e.target.value)}
              placeholder="Name or email…"
              autoFocus
            />
          </FormGroup>
          {custSearching && <p className="text-xs text-gray-400 mt-2">Searching…</p>}
          {custResults.length > 0 && (
            <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
              {custResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleLinkCustomer(c.id, c.name)}
                  disabled={linking}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 transition-colors"
                >
                  <p className="font-medium text-gray-900">{c.name}</p>
                  {c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}
                </button>
              ))}
            </div>
          )}
          {custSearch && !custSearching && custResults.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No customers found — try a different search term.</p>
          )}
          <div className="flex justify-end mt-4">
            <BtnSecondary onClick={() => setLinkOpen(false)}>Cancel</BtnSecondary>
          </div>
        </Modal>
      )}

      {/* ── Start onboarding modal ───────────────────────────────────────────── */}
      {onboardOpen && (
        <Modal title="Start customer onboarding" onClose={() => setOnboardOpen(false)} width="max-w-md">
          <p className="text-sm text-gray-500 mb-4">
            Flag this thread as requiring a new customer onboarding. Complete the onboarding in the Customers section,
            then return here to link the customer and create a ticket.
          </p>
          <FormGroup label="Note (optional)">
            <Input
              value={onboardNote}
              onChange={e => setOnboardNote(e.target.value)}
              placeholder="e.g. New pharmacy chain — high value"
            />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setOnboardOpen(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={handleStartOnboarding} disabled={onboarding}>
              {onboarding ? "Flagging…" : "Flag for Onboarding"}
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
