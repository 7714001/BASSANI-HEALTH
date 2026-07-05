import { useState, useEffect, useCallback, useRef } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import {
  Mail, AlertCircle, Paperclip, RefreshCw,
  ExternalLink, Send, Archive, Save,
  Search, Loader2, Link2, Eye, User, FileText,
} from "lucide-react";
import {
  TopBar, Badge, BtnPrimary, BtnSecondary,
  Modal, FormGroup, Input,
} from "../components/UI";

const API = "/api/onboarding-inbox";

const TABS = [
  { value: "open",               label: "Inbox"    },
  { value: "unhandled",          label: "New"      },
  { value: "application_linked", label: "Linked"   },
  { value: "archived",           label: "Archived" },
];

const STATUS_META = {
  unhandled:           { label: "New",     color: "red"   },
  reply:               { label: "Reply",   color: "blue"  },
  application_linked:  { label: "Linked",  color: "green" },
  archived:            { label: "Archived",color: "gray"  },
  sent:                { label: "Sent",    color: "teal"  },
};

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
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, color: "gray" };
  return <Badge color={m.color}>{m.label}</Badge>;
}

function AttachmentList({ attachments, itemId, onSaveToProfile, onPreview }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-black/5">
      {attachments.map((att, i) => {
        const url = att.id
          ? `${API}/${itemId}/attachment/${att.id}`
          : att.imap_attachment_id
          ? `${API}/${itemId}/imap-attachment/${att.imap_attachment_id}`
          : null;
        const key    = att.id || att.imap_attachment_id || i;
        const attKey = att.id || att.imap_attachment_id;
        const isPdf  = att.name?.toLowerCase().endsWith(".pdf");
        return (
          <div key={key} className="flex items-center gap-1">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <Paperclip size={10} className="text-gray-400" />
                {att.name}
                {att.size_bytes > 0 && (
                  <span className="text-gray-400 ml-0.5">({Math.round(att.size_bytes / 1024)}KB)</span>
                )}
                <ExternalLink size={9} className="text-gray-400" />
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-lg text-[11px] text-gray-400 cursor-not-allowed"
                title="Attachment too large to store (over 15 MB)"
              >
                <Paperclip size={10} /> {att.name}
              </span>
            )}
            {url && isPdf && onPreview && (
              <button
                onClick={() => onPreview(url, att.name)}
                title="Preview PDF"
                className="p-1 rounded text-gray-400 hover:text-bassani-600 hover:bg-bassani-50 transition-colors"
              >
                <Eye size={11} />
              </button>
            )}
            {attKey && onSaveToProfile && (
              <button
                onClick={() => onSaveToProfile(attKey, att.name)}
                title="Save to customer profile"
                className="p-1 rounded text-gray-400 hover:text-bassani-600 hover:bg-bassani-50 transition-colors"
              >
                <Save size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ThreadStatusPill({ thread }) {
  if (thread.application_id) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-50 text-green-700 border border-green-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <Link2 size={9} /> Linked
    </span>
  );
  if (thread.customer_id) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <User size={9} /> Customer
    </span>
  );
  if (thread.is_unknown_sender) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <AlertCircle size={9} /> Unknown
    </span>
  );
  return null;
}

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
          <ThreadStatusPill thread={thread} />
        </div>
      </div>
    </button>
  );
}

function MessageBubble({ msg, showDateDivider, onSaveToProfile, onPreview }) {
  const isOutgoing = msg.is_outgoing;
  const name       = msg.from_name || msg.from_email || "Unknown";
  return (
    <>
      {showDateDivider && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-[11px] text-gray-400">{fmtMsgDate(msg.received_at)}</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>
      )}
      <div className={`flex gap-3 ${isOutgoing ? "flex-row-reverse" : ""}`}>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
          isOutgoing ? "bg-bassani-500 text-white" : "bg-gray-200 text-gray-600"
        }`}>
          {initials(name)}
        </div>
        <div className={`flex-1 min-w-0 max-w-[80%] ${isOutgoing ? "items-end" : "items-start"} flex flex-col`}>
          <div className={`rounded-2xl px-4 py-3 text-[13px] ${
            isOutgoing
              ? "bg-bassani-500 text-white rounded-tr-sm"
              : "bg-white border border-gray-100 text-gray-800 rounded-tl-sm"
          }`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`text-[11px] font-semibold ${isOutgoing ? "text-bassani-100" : "text-gray-500"}`}>
                {isOutgoing ? "You" : name}
              </span>
              <span className={`text-[10px] ${isOutgoing ? "text-bassani-200" : "text-gray-400"}`}>
                {fmtTime(msg.received_at)}
              </span>
            </div>
            <div
              className={`prose prose-sm max-w-none text-[13px] leading-relaxed ${isOutgoing ? "prose-invert" : ""}`}
              dangerouslySetInnerHTML={{ __html: msg.body_html || `<p>${msg.body_preview || ""}</p>` }}
            />
            {!isOutgoing && (
              <AttachmentList
                attachments={msg.attachments}
                itemId={msg.id}
                onSaveToProfile={onSaveToProfile}
                onPreview={onPreview}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default function OnboardingInbox() {
  const { can } = useAuth();

  const [tab,            setTab           ] = useState("open");
  const [q,              setQ             ] = useState("");
  const [threads,        setThreads       ] = useState([]);
  const [total,          setTotal         ] = useState(0);
  const [loading,        setLoading       ] = useState(false);
  const [configured,     setConfigured    ] = useState(true);

  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMsgs,     setThreadMsgs    ] = useState([]);
  const [detailLoading,  setDetailLoading ] = useState(false);

  const [replyOpen,      setReplyOpen     ] = useState(false);
  const [replyHtml,      setReplyHtml     ] = useState("");
  const [replySending,   setReplySending  ] = useState(false);

  // Link to customer modal
  const [linkOpen,         setLinkOpen      ] = useState(false);
  const [linking,          setLinking       ] = useState(false);
  const [custSearch,       setCustSearch    ] = useState("");
  const [custResults,      setCustResults   ] = useState([]);
  const [custSearching,    setCustSearching ] = useState(false);
  const [selectedCustId,   setSelectedCustId] = useState(null);
  const [selectedCustName, setSelectedCustName] = useState("");

  // Save attachment modal
  const [saveAttOpen,    setSaveAttOpen   ] = useState(false);
  const [saveAttKey,     setSaveAttKey    ] = useState(null);
  const [saveAttName,    setSaveAttName   ] = useState("");
  const [saveAttLabel,   setSaveAttLabel  ] = useState("");
  const [saveAttSaving,  setSaveAttSaving ] = useState(false);

  // PDF preview modal
  const [previewUrl,     setPreviewUrl    ] = useState(null);
  const [previewName,    setPreviewName   ] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  // Send docs modal
  const [sendDocsOpen,   setSendDocsOpen  ] = useState(false);
  const [sendDocsEmail,  setSendDocsEmail ] = useState("");
  const [sendDocsCustName, setSendDocsCustName] = useState("");
  const [sendDocsSending,  setSendDocsSending ] = useState(false);

  const threadEndRef     = useRef(null);
  const selectedThreadId = selectedThread?.id;

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(API, { params: { status: tab, q: q || undefined, limit: 50 } });
      setConfigured(res.data.configured !== false);
      setThreads(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch {
      if (!silent) toast.error("Failed to load inbox");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadList(true);
    }, 30000);
    return () => clearInterval(id);
  }, [loadList]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadThread(selectedThreadId, true);
    }, 15000);
    return () => clearInterval(id);
  }, [selectedThreadId]); // eslint-disable-line

  async function loadThread(id, silent = false) {
    if (!silent) setDetailLoading(true);
    try {
      const res = await api.get(`${API}/${id}/thread`);
      setThreadMsgs(res.data.thread || []);
    } catch {
      if (!silent) toast.error("Failed to load thread");
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }

  async function selectThread(thread) {
    setSelectedThread(thread);
    setThreadMsgs([]);
    setReplyOpen(false);
    await loadThread(thread.id);
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function sendReply() {
    if (!replyHtml.trim()) return;
    setReplySending(true);
    try {
      await api.post(`${API}/${selectedThread.id}/reply`, { body_html: replyHtml });
      setReplyHtml("");
      setReplyOpen(false);
      toast.success("Reply sent");
      await loadThread(selectedThread.id, true);
      loadList(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send reply");
    } finally {
      setReplySending(false);
    }
  }

  async function archiveThread() {
    try {
      await api.post(`${API}/${selectedThread.id}/archive`);
      toast.success("Thread archived");
      setSelectedThread(null);
      loadList(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to archive");
    }
  }

  function openLinkModal() {
    setLinkOpen(true);
    setSelectedCustId(null);
    setSelectedCustName("");
    setCustSearch("");
    setCustResults([]);
  }

  async function searchCustomers(q) {
    if (!q.trim()) { setCustResults([]); return; }
    setCustSearching(true);
    try {
      const res = await api.get("/api/customers/search", { params: { q, limit: 10 } });
      setCustResults(res.data.customers || []);
    } catch {
      toast.error("Customer search failed");
    } finally {
      setCustSearching(false);
    }
  }

  useEffect(() => {
    if (!linkOpen) return;
    const t = setTimeout(() => searchCustomers(custSearch), 350);
    return () => clearTimeout(t);
  }, [custSearch, linkOpen]);

  async function linkCustomer() {
    if (!selectedCustId) return;
    setLinking(true);
    try {
      await api.post(`${API}/${selectedThread.id}/link-customer`, { odoo_partner_id: selectedCustId });
      toast.success(`Thread linked to ${selectedCustName}`);
      setLinkOpen(false);
      const res = await api.get(`${API}/${selectedThread.id}`);
      setSelectedThread(res.data);
      loadList(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link customer");
    } finally {
      setLinking(false);
    }
  }

  function openSaveAttModal(attKey, attName) {
    setSaveAttKey(attKey);
    setSaveAttName(attName);
    setSaveAttLabel(attName);
    setSaveAttOpen(true);
  }

  async function saveAttachment() {
    setSaveAttSaving(true);
    try {
      await api.post(`${API}/${selectedThread.id}/save-attachment/${saveAttKey}`, {
        label: saveAttLabel || saveAttName,
      });
      toast.success("Attachment saved to customer profile");
      setSaveAttOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save attachment");
    } finally {
      setSaveAttSaving(false);
    }
  }

  async function openPreview(url, name) {
    setPreviewLoading(true);
    setPreviewName(name);
    try {
      const res = await api.get(url, { responseType: "blob" });
      const blobUrl = URL.createObjectURL(res.data);
      setPreviewUrl(blobUrl);
    } catch {
      toast.error("Could not load preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewName("");
  }

  async function sendDocs() {
    if (!sendDocsEmail.trim()) return;
    setSendDocsSending(true);
    try {
      const res = await api.post(`${API}/send-docs`, {
        to_email: sendDocsEmail.trim(),
        customer_name: sendDocsCustName.trim(),
      });
      toast.success(`Documents sent to ${sendDocsEmail.trim()}`);
      setSendDocsOpen(false);
      setSendDocsEmail("");
      setSendDocsCustName("");
      // Navigate to the new thread
      if (res.data.item_id) {
        loadList(true);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send documents");
    } finally {
      setSendDocsSending(false);
    }
  }

  if (!can("onboarding.inbox")) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        You do not have access to the Onboarding Inbox.
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
        <Mail size={48} className="text-gray-200" />
        <div>
          <p className="text-gray-700 font-medium">Onboarding Inbox not configured</p>
          <p className="text-gray-400 text-sm mt-1">
            A super admin must connect an onboarding mailbox in Settings.
          </p>
        </div>
      </div>
    );
  }

  const detail = selectedThread;

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Onboarding Inbox">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search…"
            className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-bassani-300"
          />
        </div>
        <BtnPrimary onClick={() => setSendDocsOpen(true)}>
          <FileText size={13} /> Send Docs
        </BtnPrimary>
        <BtnSecondary onClick={() => loadList()} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </BtnSecondary>
      </TopBar>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-4 gap-1 flex-shrink-0 bg-white">
        {TABS.map(t => (
          <button
            key={t.value}
            onClick={() => { setTab(t.value); setSelectedThread(null); }}
            className={`px-3 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
              tab === t.value
                ? "border-bassani-500 text-bassani-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
            {t.value === "open" && total > 0 && (
              <span className="ml-1.5 text-[10px] bg-bassani-100 text-bassani-600 rounded-full px-1.5 py-0.5">{total}</span>
            )}
          </button>
        ))}
      </div>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0">
        {/* Thread list */}
        <div className="w-72 flex-shrink-0 border-r border-gray-100 overflow-y-auto bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin text-gray-300" />
            </div>
          ) : threads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Mail size={28} className="text-gray-200" />
              <p className="text-gray-400 text-sm">No messages</p>
            </div>
          ) : (
            threads.map(t => (
              <ThreadRow
                key={t.id}
                thread={t}
                isSelected={selectedThread?.id === t.id}
                onClick={() => selectThread(t)}
              />
            ))
          )}
        </div>

        {/* Detail pane */}
        {!detail ? (
          <div className="flex-1 flex items-center justify-center text-gray-300">
            <div className="text-center">
              <Mail size={40} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">Select a conversation</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Detail header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0 bg-white">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-gray-900 truncate">{detail.subject}</h2>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[12px] text-gray-500">{detail.from_name || detail.from_email}</span>
                  {detail.customer_name && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                      <User size={9} /> {detail.customer_name}
                    </span>
                  )}
                  {detail.application_id && (
                    <span className="text-[11px] text-green-600 font-medium">Linked to application</span>
                  )}
                  <StatusBadge status={detail.status} />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <BtnSecondary onClick={openLinkModal}>
                  <Link2 size={14} /> Link
                </BtnSecondary>
                <BtnSecondary onClick={() => setReplyOpen(r => !r)}>
                  <Send size={14} /> Reply
                </BtnSecondary>
                <BtnSecondary onClick={archiveThread} title="Archive thread">
                  <Archive size={14} />
                </BtnSecondary>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50/30">
              {detailLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={20} className="animate-spin text-gray-300" />
                </div>
              ) : (
                threadMsgs.map((msg, i) => (
                  <MessageBubble
                    key={msg.id}
                    msg={msg}
                    showDateDivider={i === 0 || !sameDay(threadMsgs[i - 1]?.received_at, msg.received_at)}
                    onSaveToProfile={openSaveAttModal}
                    onPreview={previewLoading ? null : openPreview}
                  />
                ))
              )}
              <div ref={threadEndRef} />
            </div>

            {/* Reply box */}
            {replyOpen && (
              <div className="border-t border-gray-100 px-6 py-4 bg-white flex-shrink-0">
                <textarea
                  value={replyHtml}
                  onChange={e => setReplyHtml(e.target.value)}
                  placeholder="Write your reply…"
                  rows={4}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-bassani-300 resize-none"
                />
                <div className="flex justify-end gap-2 mt-2">
                  <BtnSecondary onClick={() => setReplyOpen(false)}>Cancel</BtnSecondary>
                  <BtnPrimary onClick={sendReply} disabled={replySending || !replyHtml.trim()}>
                    {replySending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Send
                  </BtnPrimary>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Link to customer modal */}
      {linkOpen && <Modal onClose={() => setLinkOpen(false)} title="Link to Customer" width="max-w-lg">
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Link this thread to an onboarded customer. Once linked, attachments can be saved to their profile.
            Auto-detection already runs on ingest — use this when the sender's email doesn't match their Odoo record.
          </p>
          <FormGroup label="Search customer">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={custSearch}
                onChange={e => { setCustSearch(e.target.value); setSelectedCustId(null); }}
                placeholder="Name or email…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300"
                autoFocus
              />
              {custSearching && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            </div>
          </FormGroup>
          {custResults.length > 0 && (
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-48 overflow-y-auto">
              {custResults.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedCustId(c.id); setSelectedCustName(c.name); }}
                  className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                    selectedCustId === c.id
                      ? "bg-bassani-50 text-bassani-700 font-medium"
                      : "hover:bg-gray-50 text-gray-700"
                  }`}
                >
                  <span className="font-medium">{c.name}</span>
                  {c.email && <span className="text-xs text-gray-400 ml-2">{c.email}</span>}
                </button>
              ))}
            </div>
          )}
          {selectedCustId && (
            <div className="flex items-center gap-2 text-xs text-bassani-700 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
              <User size={12} /> Selected: <strong>{selectedCustName}</strong>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setLinkOpen(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={linkCustomer} disabled={!selectedCustId || linking}>
              {linking ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              Link Customer
            </BtnPrimary>
          </div>
        </div>
      </Modal>}

      {/* Save Attachment modal */}
      {saveAttOpen && <Modal onClose={() => setSaveAttOpen(false)} title="Save to Customer Profile">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will upload <span className="font-medium">{saveAttName}</span> to the customer's document profile.
          </p>
          <FormGroup label="Document label">
            <Input
              value={saveAttLabel}
              onChange={e => setSaveAttLabel(e.target.value)}
              placeholder="e.g. Section 21 Authorisation, POA, etc."
            />
          </FormGroup>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setSaveAttOpen(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={saveAttachment} disabled={saveAttSaving}>
              {saveAttSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save to Profile
            </BtnPrimary>
          </div>
        </div>
      </Modal>}

      {/* PDF preview modal */}
      {(previewUrl || previewLoading) && <Modal onClose={closePreview} title={previewName || "Document Preview"} width="max-w-4xl">
        {previewLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-gray-300" />
          </div>
        ) : (
          <div style={{ height: "70vh" }}>
            <iframe
              src={previewUrl}
              title={previewName}
              className="w-full h-full rounded-lg border border-gray-100"
              style={{ border: "none" }}
            />
          </div>
        )}
      </Modal>}

      {/* Send Docs modal */}
      {sendDocsOpen && <Modal onClose={() => setSendDocsOpen(false)} title="Send Onboarding Documents">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Send all four onboarding template PDFs from the onboarding mailbox. The customer's reply will auto-thread back into this inbox.
          </p>
          <FormGroup label="Customer email address">
            <Input
              type="email"
              value={sendDocsEmail}
              onChange={e => setSendDocsEmail(e.target.value)}
              placeholder="customer@example.co.za"
            />
          </FormGroup>
          <FormGroup label="Customer name (optional)">
            <Input
              value={sendDocsCustName}
              onChange={e => setSendDocsCustName(e.target.value)}
              placeholder="Used in the email greeting"
            />
          </FormGroup>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setSendDocsOpen(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={sendDocs} disabled={sendDocsSending || !sendDocsEmail.trim()}>
              {sendDocsSending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Send Documents
            </BtnPrimary>
          </div>
        </div>
      </Modal>}
    </div>
  );
}
