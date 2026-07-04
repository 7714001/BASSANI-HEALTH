import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  Mail, AlertCircle, Paperclip, User, ArrowLeft, RefreshCw,
  ExternalLink, Send, Archive, UserPlus, Ticket, Clock, CheckCircle2,
  ChevronDown, ChevronUp,
} from "lucide-react";
import {
  TopBar, Badge, BtnPrimary, BtnSecondary, SearchBar,
  ChipRow, FilterPill, Modal, FormGroup, Input,
} from "../components/UI";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  unhandled:          { label: "Unhandled",          color: "red"    },
  reply:              { label: "Thread Reply",        color: "blue"   },
  pending_onboarding: { label: "Pending Onboarding", color: "yellow" },
  ticket_created:     { label: "Ticket Created",     color: "green"  },
  archived:           { label: "Archived",           color: "gray"   },
};

function StatusBadge({ status }) {
  const s = STATUS_LABELS[status] || { label: status, color: "gray" };
  return <Badge color={s.color}>{s.label}</Badge>;
}

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  const now = new Date();
  const diffH = (now - dt) / 3600000;
  if (diffH < 24) return dt.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  if (diffH < 168) return dt.toLocaleDateString("en-ZA", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return dt.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_FILTERS = [
  { value: "",                   label: "Active"             },
  { value: "unhandled",          label: "Unhandled"          },
  { value: "reply",              label: "Thread Replies"     },
  { value: "pending_onboarding", label: "Pending Onboarding" },
  { value: "ticket_created",     label: "Ticket Created"     },
  { value: "archived",           label: "Archived"           },
  { value: "all",                label: "All"                },
];

// ── Subcomponents ─────────────────────────────────────────────────────────────

function AttachmentList({ attachments, itemId }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {attachments.map((att, i) => {
        const url = att.id
          ? `/api/inbox/${itemId}/attachment/${att.id}`
          : att.imap_attachment_id
          ? `/api/inbox/${itemId}/imap-attachment/${att.imap_attachment_id}`
          : null;
        const key = att.id || att.imap_attachment_id || i;
        if (!url) return (
          <span key={key}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-400 cursor-not-allowed"
            title="Attachment too large to store (over 15 MB)"
          >
            <Paperclip size={11} /> {att.name}
          </span>
        );
        return (
          <a key={key} href={url} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Paperclip size={11} className="text-gray-400" />
            {att.name}
            {att.size_bytes > 0 && (
              <span className="text-gray-400">({Math.round(att.size_bytes / 1024)} KB)</span>
            )}
            <ExternalLink size={10} className="text-gray-400" />
          </a>
        );
      })}
    </div>
  );
}

function CustomerBanner({ item }) {
  if (!item.is_unknown_sender && item.customer_name) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-xl text-sm">
        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
        <span className="text-green-800 font-medium">{item.customer_name}</span>
        <span className="text-green-600 text-xs">· Odoo customer matched</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl text-sm">
      <AlertCircle size={14} className="text-amber-500 flex-shrink-0" />
      <span className="text-amber-800">Unknown sender — link to an existing customer or start onboarding</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SalesInbox() {
  const { can, user } = useAuth();
  const navigate = useNavigate();

  // List state
  const [items,    setItems   ] = useState([]);
  const [total,    setTotal   ] = useState(0);
  const [loading,  setLoading ] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [configured,   setConfigured  ] = useState(true);

  // Detail state
  const [selected, setSelected] = useState(null);  // full item with body_html
  const [thread,   setThread  ] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showThread,    setShowThread   ] = useState(false);

  // Reply
  const [replying,     setReplying    ] = useState(false);
  const [replyText,    setReplyText   ] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  // Link-customer modal
  const [linkOpen,        setLinkOpen       ] = useState(false);
  const [custSearch,      setCustSearch     ] = useState("");
  const [custResults,     setCustResults    ] = useState([]);
  const [custSearching,   setCustSearching  ] = useState(false);
  const [linking,         setLinking        ] = useState(false);

  // Onboarding note modal
  const [onboardOpen,  setOnboardOpen ] = useState(false);
  const [onboardNote,  setOnboardNote ] = useState("");
  const [onboarding,   setOnboarding  ] = useState(false);

  // Action loading states
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [archiving,      setArchiving     ] = useState(false);

  const listRef = useRef(null);

  // ── Load list ───────────────────────────────────────────────────────────────

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const r = await api.get("/api/inbox", { params });
      if (r.data.configured === false) {
        setConfigured(false);
        setItems([]);
      } else {
        setConfigured(true);
        setItems(r.data.items || []);
        setTotal(r.data.total || 0);
      }
    } catch {
      toast.error("Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Load detail ─────────────────────────────────────────────────────────────

  const openDetail = async (item) => {
    setDetailLoading(true);
    setSelected(null);
    setThread([]);
    setShowThread(false);
    setReplying(false);
    setReplyText("");
    try {
      const [detailR, threadR] = await Promise.all([
        api.get(`/api/inbox/${item.id}`),
        api.get(`/api/inbox/${item.id}/thread`),
      ]);
      setSelected(detailR.data);
      const t = threadR.data.thread || [];
      setThread(t);
    } catch {
      toast.error("Failed to load email");
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Customer search (for link modal) ────────────────────────────────────────

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

  // ── Actions ─────────────────────────────────────────────────────────────────

  const handleCreateTicket = async () => {
    if (!selected) return;
    setCreatingTicket(true);
    try {
      const r = await api.post(`/api/inbox/${selected.id}/create-ticket`);
      toast.success("Sales ticket created");
      setSelected(prev => ({ ...prev, ticket_id: r.data.ticket_id, status: "ticket_created" }));
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicket(false);
    }
  };

  const handleSendReply = async () => {
    if (!selected || !replyText.trim()) return;
    setSendingReply(true);
    try {
      await api.post(`/api/inbox/${selected.id}/reply`, {
        body_html: `<p>${replyText.replace(/\n/g, "<br/>")}</p>`,
      });
      toast.success("Reply sent");
      setReplying(false);
      setReplyText("");
      // Reload thread so the sent reply appears immediately
      const threadR = await api.get(`/api/inbox/${selected.id}/thread`);
      setThread(threadR.data.thread || []);
      setShowThread(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const handleLinkCustomer = async (customerId, customerName) => {
    if (!selected) return;
    setLinking(true);
    try {
      await api.post(`/api/inbox/${selected.id}/link-customer`, { customer_id: customerId });
      toast.success(`Linked to ${customerName}`);
      setSelected(prev => ({
        ...prev,
        customer_id: customerId,
        customer_name: customerName,
        is_unknown_sender: false,
        status: "unhandled",
      }));
      setLinkOpen(false);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link customer");
    } finally {
      setLinking(false);
    }
  };

  const handleStartOnboarding = async () => {
    if (!selected) return;
    setOnboarding(true);
    try {
      await api.post(`/api/inbox/${selected.id}/start-onboarding`, { note: onboardNote });
      toast.success("Flagged for onboarding");
      setSelected(prev => ({ ...prev, status: "pending_onboarding" }));
      setOnboardOpen(false);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to start onboarding");
    } finally {
      setOnboarding(false);
    }
  };

  const handleArchive = async () => {
    if (!selected) return;
    setArchiving(true);
    try {
      await api.post(`/api/inbox/${selected.id}/archive`);
      toast.success("Archived");
      setSelected(null);
      loadList();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to archive");
    } finally {
      setArchiving(false);
    }
  };

  const handlePoll = async () => {
    try {
      const r = await api.post("/api/inbox/poll");
      toast.success(`Polling inbox — ${r.data.queued} message(s) queued for ingestion`);
      setTimeout(loadList, 3000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Poll failed");
    }
  };

  // ── Guard ────────────────────────────────────────────────────────────────────

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
        <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
          <div className="max-w-md text-center">
            <div className="w-16 h-16 bg-amber-50 border border-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Mail size={28} className="text-amber-400" />
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Sales Inbox not yet active</h2>
            {user?.is_super_admin ? (
              <>
                <p className="text-sm text-gray-500 mb-5 leading-relaxed">
                  No mailbox has been connected. Connect an IMAP mailbox in Settings to activate the inbox for all staff.
                </p>
                <button
                  onClick={() => navigate("/settings/mailbox")}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-bassani-600 text-white text-sm font-semibold rounded-xl hover:bg-bassani-700 transition-colors"
                >
                  <Mail size={14} />
                  Connect Mailbox
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 leading-relaxed">
                The sales inbox has not been configured yet. Ask your system administrator to connect a mailbox in portal settings.
              </p>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Detail panel ─────────────────────────────────────────────────────────────

  if (selected || detailLoading) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar
          title="Sales Inbox"
          subtitle={selected ? selected.subject : "Loading…"}
          leftAction={
            <button
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mr-3"
            >
              <ArrowLeft size={14} /> Back
            </button>
          }
        />

        {detailLoading && (
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw size={20} className="animate-spin text-gray-300" />
          </div>
        )}

        {selected && !detailLoading && (
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="max-w-4xl mx-auto space-y-4">

              {/* Header card */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 flex-1 min-w-0">
                    <h1 className="text-base font-semibold text-gray-900 truncate">{selected.subject}</h1>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      <span className="font-medium text-gray-700">{selected.from_name}</span>
                      <span>&lt;{selected.from_email}&gt;</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmtDate(selected.received_at)}</span>
                    </div>
                  </div>
                  <StatusBadge status={selected.status} />
                </div>

                <CustomerBanner item={selected} />
              </div>

              {/* Email body */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div
                  className="prose prose-sm max-w-none text-gray-700 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: selected.body_html || selected.body_preview }}
                />
                <AttachmentList attachments={selected.attachments} itemId={selected.id} />
              </div>

              {/* Thread (collapsible) */}
              {thread.length > 1 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                  <button
                    onClick={() => setShowThread(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-2xl transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Mail size={14} className="text-gray-400" />
                      Thread — {thread.length} messages
                    </span>
                    {showThread ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {showThread && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {thread.map((msg, i) => {
                        const isOut = msg.is_outgoing;
                        return (
                          <div key={msg.id || i} className={`px-5 py-4 ${msg.id === selected.id ? "bg-bassani-50" : isOut ? "bg-teal-50" : ""}`}>
                            <div className={`flex items-center gap-2 text-xs text-gray-500 mb-2 ${isOut ? "flex-row-reverse" : ""}`}>
                              <span className={`font-medium ${isOut ? "text-teal-700" : "text-gray-700"}`}>{msg.from_name}</span>
                              <span>{fmtDate(msg.received_at)}</span>
                              {isOut && <Badge color="green">Sent</Badge>}
                              {msg.id === selected.id && !isOut && <Badge color="blue">Current</Badge>}
                            </div>
                            <p className={`text-sm text-gray-700 line-clamp-3 ${isOut ? "text-right" : ""}`}>{msg.body_preview}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Actions card */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</p>

                {/* Reply */}
                {!replying ? (
                  <button
                    onClick={() => setReplying(true)}
                    className="inline-flex items-center gap-2 text-sm text-bassani-600 hover:text-bassani-700 font-medium transition-colors"
                  >
                    <Send size={14} /> Reply to sender
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-600">Reply to {selected.from_email}</p>
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply…"
                      rows={5}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-bassani-500 focus:border-transparent resize-none"
                    />
                    <div className="flex gap-2">
                      <BtnPrimary onClick={handleSendReply} disabled={sendingReply || !replyText.trim()}>
                        {sendingReply ? "Sending…" : "Send Reply"}
                      </BtnPrimary>
                      <BtnSecondary onClick={() => { setReplying(false); setReplyText(""); }}>
                        Cancel
                      </BtnSecondary>
                    </div>
                  </div>
                )}

                <hr className="border-gray-100" />

                {/* Customer actions */}
                {selected.is_unknown_sender && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setLinkOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                    >
                      <User size={14} /> Link to existing customer
                    </button>
                    <button
                      onClick={() => setOnboardOpen(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                    >
                      <UserPlus size={14} /> Start onboarding
                    </button>
                  </div>
                )}

                {/* Create ticket */}
                {!selected.ticket_id && !selected.is_unknown_sender && (
                  <button
                    onClick={handleCreateTicket}
                    disabled={creatingTicket}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-bassani-600 text-white rounded-xl text-sm font-medium hover:bg-bassani-700 transition-colors disabled:opacity-60"
                  >
                    <Ticket size={14} />
                    {creatingTicket ? "Creating…" : "Create Sales Ticket"}
                  </button>
                )}

                {selected.ticket_id && (
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-100 rounded-xl text-sm text-green-700">
                    <CheckCircle2 size={14} className="text-green-500" />
                    Ticket created — go to Sales Tickets to manage it
                  </div>
                )}

                {/* Archive */}
                {!["archived", "ticket_created"].includes(selected.status) && (
                  <div>
                    <button
                      onClick={handleArchive}
                      disabled={archiving}
                      className="inline-flex items-center gap-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <Archive size={12} />
                      {archiving ? "Archiving…" : "Archive (dismiss without creating ticket)"}
                    </button>
                  </div>
                )}
              </div>

            </div>
          </main>
        )}

        {/* Link customer modal */}
        {linkOpen && (
          <Modal title="Link to existing customer" onClose={() => setLinkOpen(false)} width="max-w-md">
            <p className="text-sm text-gray-500 mb-4">
              Search for the Odoo customer that matches this sender. Once linked, you can create a sales ticket.
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

        {/* Start onboarding modal */}
        {onboardOpen && (
          <Modal title="Start customer onboarding" onClose={() => setOnboardOpen(false)} width="max-w-md">
            <p className="text-sm text-gray-500 mb-4">
              Flag this email as requiring a new customer onboarding. Complete the onboarding in the Customers section,
              then return here to link the customer and create a sales ticket.
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

  // ── List panel ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Sales Inbox"
        subtitle={configured ? `${total} item${total !== 1 ? "s" : ""} · orders@bassanihealth.com` : ""}
        onRefresh={loadList}
        actions={
          <button
            onClick={handlePoll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            title="Poll inbox for new messages"
          >
            <RefreshCw size={12} /> Sync now
          </button>
        }
      />

      <main className="flex-1 overflow-y-auto p-4 sm:p-6" ref={listRef}>
        <div className="mb-4">
          <ChipRow>
            {STATUS_FILTERS.map(f => (
              <FilterPill
                key={f.value}
                label={f.label}
                active={statusFilter === f.value}
                onClick={() => setStatusFilter(f.value)}
              />
            ))}
          </ChipRow>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={20} className="animate-spin text-gray-300" />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-center mb-3">
              <Mail size={22} className="text-gray-300" />
            </div>
            <p className="text-sm font-medium text-gray-500">No inbox items</p>
            <p className="text-xs text-gray-400 mt-1">
              {statusFilter ? "Try a different filter" : "New emails will appear here automatically"}
            </p>
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="space-y-2 max-w-3xl">
            {items.map(item => (
              <button
                key={item.id}
                onClick={() => openDetail(item)}
                className={`w-full text-left bg-white border rounded-2xl px-5 py-4 transition-all hover:shadow-sm hover:border-gray-200 ${
                  item.status === "unhandled" ? "border-bassani-200 shadow-sm" : "border-gray-100"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-sm font-medium truncate ${item.status === "unhandled" ? "text-gray-900" : "text-gray-600"}`}>
                        {item.from_name || item.from_email}
                      </p>
                      {item.is_unknown_sender && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                          <AlertCircle size={9} /> Unknown
                        </span>
                      )}
                      {item.has_attachments && <Paperclip size={11} className="text-gray-300 flex-shrink-0" />}
                    </div>
                    <p className={`text-sm truncate ${item.status === "unhandled" ? "text-gray-800" : "text-gray-500"}`}>
                      {item.subject}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{item.body_preview}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{fmtDate(item.received_at)}</span>
                    <StatusBadge status={item.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
