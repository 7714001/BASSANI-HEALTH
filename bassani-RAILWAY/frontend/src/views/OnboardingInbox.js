import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { stripEmailQuote } from "../utils/stripEmailQuote";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Mail, AlertCircle, Paperclip, RefreshCw,
  ExternalLink, Send, Archive, Save,
  Search, Loader2, Link2, Eye, User, FileText,
  UserPlus, CheckCircle, Upload, X,
} from "lucide-react";
import {
  TopBar, Badge, BtnPrimary, BtnSecondary,
  Modal, FormGroup, Input,
} from "../components/UI";

const API = "/api/onboarding-inbox";

const TABS = [
  { value: "open",              label: "Inbox"         },
  { value: "unhandled",         label: "New"           },
  { value: "in_progress",       label: "In Progress"   },
  { value: "application_linked",label: "Linked"        },
  { value: "docs_complete",     label: "Docs Complete" },
  { value: "archived",          label: "Archived"      },
];

const REQUIRED_DOC_TYPES = [
  { key: "store_onboarding_agreement", label: "Signed Store Onboarding Agreement" },
  { key: "customer_information_form",  label: "Signed Customer Information Form"  },
  { key: "nda",                        label: "Signed NDA"                        },
  { key: "tqa",                        label: "Signed TQA Document"               },
  { key: "cipc_certificate",           label: "CIPC Company Registration Certificate" },
];

const CUSTOMER_TYPES = ["Pharmacy", "Dispensary", "Clinic", "Hospital", "Retail"];

const BLANK_CREATE_FORM = {
  name: "", email: "", phone: "", street: "", city: "", zip: "",
  vat: "", customer_type: "Pharmacy", section21_registered: false, credit_limit: "",
};

const STATUS_META = {
  unhandled:           { label: "New",            color: "red"    },
  reply:               { label: "Reply",          color: "blue"   },
  in_progress:         { label: "In Progress",    color: "amber"  },
  awaiting_docs:       { label: "Awaiting Docs",  color: "amber"  },
  docs_complete:       { label: "Docs Complete",  color: "green"  },
  application_linked:  { label: "Linked",         color: "green"  },
  archived:            { label: "Archived",       color: "gray"   },
  sent:                { label: "Sent",           color: "teal"   },
};

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
  const received = thread.received_doc_types || [];
  const total    = REQUIRED_DOC_TYPES.length;
  const count    = received.length;

  if (thread.status === "docs_complete") return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-50 text-green-700 border border-green-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <CheckCircle size={9} /> {count}/{total} docs
    </span>
  );
  if (count > 0) return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 rounded px-1.5 py-0.5 flex-shrink-0">
      <FileText size={9} /> {count}/{total} docs
    </span>
  );
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
  const [showQuote, setShowQuote] = useState(false);

  const { body, hasQuote, quoteHtml } = useMemo(() => {
    if (isOutgoing) return { body: msg.body_html || `<p>${msg.body_preview || ""}</p>`, hasQuote: false, quoteHtml: "" };
    return stripEmailQuote(msg.body_html || `<p>${msg.body_preview || ""}</p>`);
  }, [msg.body_html, msg.body_preview, isOutgoing]);

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
              dangerouslySetInnerHTML={{ __html: body }}
            />
            {hasQuote && (
              <>
                {showQuote && (
                  <div
                    className="mt-3 pt-3 border-t border-gray-100 prose prose-sm max-w-none text-[12px] leading-relaxed text-gray-400"
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
  const { can }         = useAuth();
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();

  const [tab,            setTab           ] = useState("open");
  const [q,              setQ             ] = useState("");
  const [threads,        setThreads       ] = useState([]);
  const [total,          setTotal         ] = useState(0);
  const [loading,        setLoading       ] = useState(false);
  const [configured,      setConfigured    ] = useState(true);
  const [mailboxAddress,  setMailboxAddress] = useState("");

  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMsgs,     setThreadMsgs    ] = useState([]);
  const [detailLoading,  setDetailLoading ] = useState(false);

  const [replyOpen,      setReplyOpen     ] = useState(false);
  const [replyHtml,      setReplyHtml     ] = useState("");
  const [replySending,   setReplySending  ] = useState(false);

  // Customer search shared by Save Docs confirm step
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
  const [sendDocsOpen,      setSendDocsOpen     ] = useState(false);
  const [sendDocsEmail,     setSendDocsEmail    ] = useState("");
  const [sendDocsCustName,  setSendDocsCustName ] = useState("");
  const [sendDocsSending,   setSendDocsSending  ] = useState(false);
  const [sendDocsCustQ,     setSendDocsCustQ    ] = useState("");
  const [sendDocsCustRes,   setSendDocsCustRes  ] = useState([]);
  const [sendDocsCustSearch,setSendDocsCustSearch] = useState(false);

  // Create customer from inbox flow
  const [createOpen,     setCreateOpen    ] = useState(false);
  const [createStep,     setCreateStep    ] = useState("map"); // "map" | "details"
  const [createMappings, setCreateMappings] = useState({}); // { doc_type: att_key }
  const [createForm,     setCreateForm    ] = useState(BLANK_CREATE_FORM);
  const [createSaving,   setCreateSaving  ] = useState(false);

  // Save to Application modal (reseller-originated threads — no customer yet)
  const [saveAppOpen,        setSaveAppOpen       ] = useState(false);
  const [saveAppAssignments, setSaveAppAssignments] = useState({});
  const [saveAppSaving,      setSaveAppSaving     ] = useState(false);

  // Save Documents modal (threads with a linked customer)
  const [saveDocsOpen,        setSaveDocsOpen       ] = useState(false);
  const [saveDocsStep,        setSaveDocsStep       ] = useState("assign"); // "assign" | "confirm" | "overwrite-confirm"
  const [saveDocsAssignments, setSaveDocsAssignments] = useState({}); // { att_key: { label, doc_type } }
  const [saveDocsCustomLabels,setSaveDocsCustomLabels] = useState({}); // { att_key: custom label text }
  const [saveDocsSaving,      setSaveDocsSaving     ] = useState(false);
  const [saveDocsExisting,    setSaveDocsExisting   ] = useState({}); // { doc_type: docRecord } — existing docs on the customer profile

  const threadEndRef     = useRef(null);
  const selectedThreadId = selectedThread?.id;

  // All attachments across non-outgoing thread messages — used by the create-customer doc mapper
  const threadAttachments = useMemo(() => {
    const seen = new Set();
    const all  = [];
    for (const msg of threadMsgs) {
      if (msg.is_outgoing) continue;
      for (const att of (msg.attachments || [])) {
        const key = att.id || att.imap_attachment_id;
        if (key && !seen.has(key)) {
          seen.add(key);
          all.push({ key, name: att.name || "attachment", size: att.size_bytes || 0 });
        }
      }
    }
    return all;
  }, [threadMsgs]);

  const loadList = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get(API, { params: { status: tab, q: q || undefined, limit: 50 } });
      setConfigured(res.data.configured !== false);
      setThreads(res.data.items || []);
      setTotal(res.data.total || 0);
      if (res.data.mailbox_address) setMailboxAddress(res.data.mailbox_address);
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

  // Auto-select a thread when navigated here via ?thread= from an application detail page
  useEffect(() => {
    const threadId = searchParams.get("thread");
    if (!threadId) return;
    (async () => {
      try {
        const res  = await api.get(`${API}/${threadId}/thread`);
        const msgs = res.data.thread || [];
        if (msgs.length) {
          setSelectedThread(msgs[0]);
          setThreadMsgs(msgs);
        }
      } catch {}
    })();
  }, []); // eslint-disable-line

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
    const searching = saveDocsOpen && saveDocsStep === "confirm";
    if (!searching) return;
    const t = setTimeout(() => searchCustomers(custSearch), 350);
    return () => clearTimeout(t);
  }, [custSearch, saveDocsOpen, saveDocsStep]); // eslint-disable-line

  // Customer search for Send Docs modal
  useEffect(() => {
    if (!sendDocsOpen || !sendDocsCustQ.trim()) { setSendDocsCustRes([]); return; }
    const t = setTimeout(async () => {
      setSendDocsCustSearch(true);
      try {
        const r = await api.get("/api/customers/search", { params: { q: sendDocsCustQ, limit: 8 } });
        setSendDocsCustRes(r.data.customers || []);
      } catch { setSendDocsCustRes([]); }
      finally { setSendDocsCustSearch(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [sendDocsCustQ, sendDocsOpen]); // eslint-disable-line


  function openCreateModal() {
    setCreateStep("map");
    setCreateMappings({});
    setCreateForm({
      ...BLANK_CREATE_FORM,
      name:  selectedThread?.from_name  || "",
      email: selectedThread?.from_email || "",
    });
    setCreateOpen(true);
  }

  async function createCustomer() {
    if (!createForm.name.trim()) { toast.error("Customer name is required"); return; }
    setCreateSaving(true);
    try {
      // 1. Create the Odoo customer record (no docs yet — upload happens after linking)
      const res = await api.post("/api/customers/", {
        ...createForm,
        credit_limit: parseFloat(createForm.credit_limit) || 0,
      });
      const newCustomerId = res.data.customer_id;

      // 2. Link this inbox thread to the new customer
      try {
        await api.post(`${API}/${selectedThread.id}/link-customer`, {
          odoo_partner_id: newCustomerId,
        });
      } catch { /* non-fatal */ }

      // 3. Save any mapped email attachments to the customer's profile
      //    Uses the existing save-documents endpoint — R2 write happens here, once, on success
      const assignments = Object.entries(createMappings)
        .filter(([, attKey]) => attKey)
        .map(([doc_type, attachment_id]) => ({
          attachment_id,
          doc_type,
          label: REQUIRED_DOC_TYPES.find(d => d.key === doc_type)?.label || doc_type,
        }));
      if (assignments.length) {
        try {
          await api.post(`${API}/${selectedThread.id}/save-documents`, { assignments });
        } catch { /* non-fatal — docs can be uploaded via customer profile */ }
      }

      toast.success(`Customer ${createForm.name} created`);
      setCreateOpen(false);
      // Refresh thread to show linked customer + updated doc state
      const updated = await api.get(`${API}/${selectedThread.id}`);
      setSelectedThread(updated.data);
      loadList(true);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (detail && typeof detail === "object" && detail.existing) {
        toast.error(`Duplicate: ${detail.existing.name} already exists with this email or VAT.`);
      } else {
        toast.error(typeof detail === "string" ? detail : "Failed to create customer");
      }
    } finally {
      setCreateSaving(false);
    }
  }

  function openSaveAppModal() {
    setSaveAppAssignments({});
    setSaveAppOpen(true);
  }

  async function saveToApplication() {
    const assignments = Object.entries(saveAppAssignments)
      .filter(([, v]) => v?.doc_type && v.doc_type !== "__skip__")
      .map(([att_key, v]) => ({ attachment_id: att_key, label: v.label, doc_type: v.doc_type }));

    if (!assignments.length) { toast.error("Assign at least one attachment to a document slot"); return; }
    setSaveAppSaving(true);
    try {
      const res = await api.post(`${API}/${selectedThread.id}/save-documents-to-application`, {
        app_id: detail.application_id,
        assignments,
      });
      const n = res.data.saved;
      toast.success(`${n} document${n !== 1 ? "s" : ""} saved to application`);
      setSaveAppOpen(false);
      loadList(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save documents to application");
    } finally {
      setSaveAppSaving(false);
    }
  }

  function openSaveDocsModal() {
    setSaveDocsAssignments({});
    setSaveDocsCustomLabels({});
    setSaveDocsExisting({});
    setSaveDocsStep("assign");
    setSaveDocsOpen(true);

    // Fetch existing docs for this customer so we can warn before overwriting
    if (selectedThread?.customer_id) {
      api.get(`/api/customers/${selectedThread.customer_id}/documents`)
        .then(r => {
          const byType = {};
          for (const doc of (r.data.documents || [])) {
            if (doc.doc_type && !byType[doc.doc_type]) byType[doc.doc_type] = doc;
          }
          setSaveDocsExisting(byType);
        })
        .catch(() => {}); // non-fatal — missing existing-doc info just skips the warning
    }
  }

  async function confirmCustomerForSave() {
    if (!selectedCustId) return;
    setLinking(true);
    try {
      await api.post(`${API}/${selectedThread.id}/link-customer`, { odoo_partner_id: selectedCustId });
      const res = await api.get(`${API}/${selectedThread.id}`);
      setSelectedThread(res.data);
      loadList(true);
      setSaveDocsStep("assign");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link customer");
    } finally {
      setLinking(false);
    }
  }

  async function saveDocs() {
    const assignments = Object.entries(saveDocsAssignments)
      .filter(([, v]) => v && v.doc_type && v.doc_type !== "__skip__")
      .map(([att_key, v]) => ({
        attachment_id: att_key,
        label:  v.doc_type === "custom" ? (saveDocsCustomLabels[att_key] || "Document") : v.label,
        doc_type: v.doc_type !== "custom" ? v.doc_type : null,
      }));

    if (!assignments.length) {
      toast.error("Assign at least one attachment to a document slot");
      return;
    }

    // Gate: if any assigned doc_types already exist on the customer profile and the user
    // hasn't explicitly confirmed the overwrite, switch to the confirmation step.
    if (saveDocsStep !== "overwrite-confirm") {
      const overwrites = assignments.filter(a => a.doc_type && saveDocsExisting[a.doc_type]);
      if (overwrites.length > 0) {
        setSaveDocsStep("overwrite-confirm");
        return;
      }
    }

    setSaveDocsSaving(true);
    try {
      const res = await api.post(`${API}/${selectedThread.id}/save-documents`, { assignments });
      const n = res.data.saved;
      toast.success(`${n} document${n !== 1 ? "s" : ""} saved to customer profile`);
      setSaveDocsOpen(false);
      loadList(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save documents");
    } finally {
      setSaveDocsSaving(false);
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
      <TopBar
        title="Onboarding Inbox"
        subtitle={mailboxAddress || undefined}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg w-52 focus:outline-none focus:ring-2 focus:ring-bassani-300"
              />
            </div>
            <BtnPrimary onClick={() => { setSendDocsOpen(true); setSendDocsEmail(""); setSendDocsCustName(""); setSendDocsCustQ(""); setSendDocsCustRes([]); }}>
              <FileText size={13} /> Send Docs
            </BtnPrimary>
            <BtnSecondary onClick={() => loadList()} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </BtnSecondary>
          </div>
        }
      />

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
                    <button
                      onClick={() => navigate(`/applications/${detail.application_id}`)}
                      className="inline-flex items-center gap-1 text-[11px] text-green-600 font-medium bg-green-50 border border-green-100 rounded px-1.5 py-0.5 hover:bg-green-100 transition-colors"
                    >
                      <Link2 size={9} /> Application linked
                    </button>
                  )}
                  <StatusBadge status={detail.status} />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {detail.application_id ? (
                  <BtnPrimary onClick={() => navigate(`/applications/${detail.application_id}`)}>
                    <Link2 size={14} /> Review Application
                  </BtnPrimary>
                ) : !detail.customer_id ? (
                  <BtnPrimary onClick={openCreateModal}>
                    <UserPlus size={14} /> Create Customer
                  </BtnPrimary>
                ) : null}
                {/* Save to Application — reseller thread, no customer yet */}
                {detail.application_id && !detail.customer_id && threadAttachments.length > 0 && (
                  <BtnSecondary onClick={openSaveAppModal}>
                    <Save size={14} /> Save to Application
                  </BtnSecondary>
                )}
                {/* Save Documents — thread has a linked customer */}
                {detail.customer_id && threadAttachments.length > 0 && (
                  <BtnPrimary onClick={openSaveDocsModal}>
                    <Save size={14} /> Save Documents
                  </BtnPrimary>
                )}
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

      {/* Create Customer modal */}
      {createOpen && (
        <Modal
          onClose={() => setCreateOpen(false)}
          title="Create Customer from Inbox"
          width="max-w-2xl"
        >
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-5">
            {[{ key: "map", label: "Map Documents" }, { key: "details", label: "Customer Details" }].map((s, i) => {
              const done    = createStep === "details" && i === 0;
              const current = createStep === s.key;
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    done ? "bg-green-500 text-white" : current ? "bg-bassani-600 text-white" : "bg-gray-100 text-gray-400"
                  }`}>{done ? "✓" : i + 1}</div>
                  <span className={`text-xs font-medium ${current ? "text-bassani-700" : done ? "text-green-700" : "text-gray-400"}`}>{s.label}</span>
                  {i === 0 && <div className="w-8 h-px bg-gray-200 mx-1" />}
                </div>
              );
            })}
          </div>

          {/* ── Step 1: Map documents ── */}
          {createStep === "map" && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Match each required onboarding document to an attachment from this email thread.
                Leave slots blank if the attachment wasn't included — you can upload them manually in the next step.
              </p>

              {threadAttachments.length === 0 && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 text-xs text-amber-700">
                  <AlertCircle size={13} className="shrink-0" />
                  No attachments found in this thread. You can still create the customer and upload documents manually in the next step.
                </div>
              )}

              <div className="space-y-2">
                {REQUIRED_DOC_TYPES.map(dt => (
                  <div key={dt.key} className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-gray-50 border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-700 truncate">{dt.label}</p>
                    </div>
                    <select
                      value={createMappings[dt.key] || ""}
                      onChange={e => setCreateMappings(prev => ({ ...prev, [dt.key]: e.target.value || undefined }))}
                      className="w-56 shrink-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-bassani-300 text-gray-700"
                    >
                      <option value="">— not in this email —</option>
                      {threadAttachments.map(att => (
                        <option key={att.key} value={att.key}>{att.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {Object.values(createMappings).filter(Boolean).length} of {REQUIRED_DOC_TYPES.length} matched from email
                </span>
                <BtnPrimary onClick={() => setCreateStep("details")}>
                  Continue
                </BtnPrimary>
              </div>
            </div>
          )}

          {/* ── Step 2: Customer details ── */}
          {createStep === "details" && (
            <div className="space-y-4">
              {/* Doc mapping preview — read-only, upload happens on Create */}
              {(() => {
                const mappedCount = Object.values(createMappings).filter(Boolean).length;
                return (
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-600">Documents from this email</p>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        mappedCount === REQUIRED_DOC_TYPES.length ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                      }`}>{mappedCount} / {REQUIRED_DOC_TYPES.length} mapped</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {REQUIRED_DOC_TYPES.map(dt => {
                        const attKey  = createMappings[dt.key];
                        const attName = attKey ? threadAttachments.find(a => a.key === attKey)?.name : null;
                        return (
                          <div key={dt.key} className={`flex items-center gap-3 px-3 py-2 ${attName ? "bg-green-50/40" : ""}`}>
                            <div className="shrink-0">
                              {attName
                                ? <CheckCircle size={13} className="text-green-600" />
                                : <div className="w-3 h-3 rounded-full border-2 border-gray-300" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[11px] font-semibold truncate ${attName ? "text-green-800" : "text-gray-500"}`}>{dt.label}</p>
                              {attName
                                ? <p className="text-[10px] text-green-600 truncate">{attName}</p>
                                : <p className="text-[10px] text-gray-400">Not in this email — upload via customer profile after creation</p>
                              }
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {mappedCount < REQUIRED_DOC_TYPES.length && (
                      <div className="px-3 py-2 bg-amber-50/60 border-t border-amber-100">
                        <p className="text-[11px] text-amber-700">Missing docs can be uploaded from the customer profile once the account is created.</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Customer form */}
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <FormGroup label="Customer Name *">
                    <Input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))} placeholder="Registered company name" autoFocus />
                  </FormGroup>
                </div>
                <FormGroup label="Email">
                  <Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="orders@example.co.za" />
                </FormGroup>
                <FormGroup label="Phone">
                  <Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))} placeholder="+27 11 555 1234" />
                </FormGroup>
                <FormGroup label="VAT Number">
                  <Input value={createForm.vat} onChange={e => setCreateForm(f => ({ ...f, vat: e.target.value }))} placeholder="4xxxxxxxxx" />
                </FormGroup>
                <FormGroup label="Customer Type">
                  <select
                    value={createForm.customer_type}
                    onChange={e => setCreateForm(f => ({ ...f, customer_type: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bassani-300"
                  >
                    {CUSTOMER_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </FormGroup>
                <FormGroup label="Street">
                  <Input value={createForm.street} onChange={e => setCreateForm(f => ({ ...f, street: e.target.value }))} placeholder="123 Health Street" />
                </FormGroup>
                <FormGroup label="City">
                  <Input value={createForm.city} onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))} placeholder="Johannesburg" />
                </FormGroup>
                <FormGroup label="Credit Limit (R)">
                  <Input type="number" value={createForm.credit_limit} onChange={e => setCreateForm(f => ({ ...f, credit_limit: e.target.value }))} placeholder="0" />
                </FormGroup>
                <div className="col-span-2 flex items-center gap-2 pt-1">
                  <input type="checkbox" id="s21_create"
                    checked={createForm.section21_registered}
                    onChange={e => setCreateForm(f => ({ ...f, section21_registered: e.target.checked }))}
                    className="rounded border-gray-300 text-bassani-600 focus:ring-bassani-300"
                  />
                  <label htmlFor="s21_create" className="text-xs text-gray-700">Section 21 registered patient</label>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-gray-100">
                <BtnSecondary onClick={() => setCreateStep("map")}>← Back</BtnSecondary>
                <BtnPrimary onClick={createCustomer} disabled={createSaving || !createForm.name.trim()}>
                  {createSaving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                  {createSaving ? "Creating…" : "Create Customer"}
                </BtnPrimary>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* Save to Application modal */}
      {saveAppOpen && (
        <Modal onClose={() => setSaveAppOpen(false)} title="Save Documents to Application" width="max-w-xl">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-bassani-700 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
              <Link2 size={12} />
              Saving to application: <strong>{detail?.application_id}</strong>
            </div>
            <p className="text-xs text-gray-500">
              Assign each attachment to a document slot. Documents saved here are held against the pending application.
              When the application is approved and the customer is created, these documents are automatically linked to their profile — no re-upload needed.
            </p>
            {threadAttachments.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No attachments found in this thread.</p>
            ) : (
              <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
                {threadAttachments.map(att => {
                  const assignment = saveAppAssignments[att.key] || {};
                  const docType    = assignment.doc_type || "";
                  return (
                    <div key={att.key} className="px-3 py-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <FileText size={12} className="text-gray-400 shrink-0" />
                        <span className="text-xs font-medium text-gray-700 truncate flex-1">{att.name}</span>
                        {att.size > 0 && <span className="text-[10px] text-gray-400 shrink-0">{Math.round(att.size / 1024)}KB</span>}
                      </div>
                      <select
                        value={docType}
                        onChange={e => {
                          const val = e.target.value;
                          const opt = REQUIRED_DOC_TYPES.find(d => d.key === val);
                          setSaveAppAssignments(prev => ({
                            ...prev,
                            [att.key]: { doc_type: val, label: opt?.label || val },
                          }));
                        }}
                        className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-300 ${
                          !docType ? "border-amber-300 bg-amber-50" : "border-gray-200"
                        }`}
                      >
                        <option value="">— assign to document slot —</option>
                        <option value="__skip__">Don't save this attachment</option>
                        {REQUIRED_DOC_TYPES.map(dt => (
                          <option key={dt.key} value={dt.key}>{dt.label}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <BtnSecondary onClick={() => setSaveAppOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary
                onClick={saveToApplication}
                disabled={saveAppSaving || !Object.values(saveAppAssignments).some(v => v?.doc_type && v.doc_type !== "__skip__")}
              >
                {saveAppSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save {Object.values(saveAppAssignments).filter(v => v?.doc_type && v.doc_type !== "__skip__").length || ""} Documents
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}

      {/* Save Documents modal */}
      {saveDocsOpen && <Modal onClose={() => setSaveDocsOpen(false)} title="Save Documents to Profile" width="max-w-xl">
        {saveDocsStep === "confirm" ? (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">
              This thread is not yet linked to a customer. Confirm the customer below to continue.
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
              <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-44 overflow-y-auto">
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
              <BtnSecondary onClick={() => setSaveDocsOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={confirmCustomerForSave} disabled={!selectedCustId || linking}>
                {linking ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                Confirm and Continue
              </BtnPrimary>
            </div>
          </div>
        ) : saveDocsStep === "overwrite-confirm" ? (() => {
          // Derive which assignments conflict with existing docs
          const overwrites = Object.entries(saveDocsAssignments)
            .filter(([, v]) => v?.doc_type && v.doc_type !== "__skip__" && v.doc_type !== "custom" && saveDocsExisting[v.doc_type])
            .map(([att_key, v]) => ({
              att_key,
              doc_type:    v.doc_type,
              label:       v.label,
              newFilename: threadAttachments.find(a => a.key === att_key)?.name || "email attachment",
              oldFilename: saveDocsExisting[v.doc_type]?.filename || "existing file",
              oldSource:   saveDocsExisting[v.doc_type]?.source   || "admin",
            }));
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Existing documents will be replaced</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {selectedThread?.customer_name || "This customer"} already has the following documents on file.
                    Saving will permanently replace them with the versions from this email.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-amber-100 overflow-hidden">
                {overwrites.map(ow => (
                  <div key={ow.doc_type} className="px-4 py-3 border-b border-amber-50 last:border-0">
                    <p className="text-[11px] font-semibold text-gray-700">{ow.label}</p>
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500">
                      <span className="line-through text-red-400">{ow.oldFilename}</span>
                      <span className="text-gray-300">→</span>
                      <span className="text-green-700 font-medium">{ow.newFilename}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <BtnSecondary onClick={() => setSaveDocsStep("assign")}>Go Back</BtnSecondary>
                <BtnPrimary onClick={saveDocs} disabled={saveDocsSaving}>
                  {saveDocsSaving ? <Loader2 size={14} className="animate-spin" /> : <AlertCircle size={14} />}
                  {saveDocsSaving ? "Saving…" : "Overwrite and Save"}
                </BtnPrimary>
              </div>
            </div>
          );
        })() : (
          <div className="space-y-4">
            {(selectedThread?.customer_name || selectedThread?.customer_id) && (
              <div className="flex items-center gap-2 text-xs text-bassani-700 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
                <User size={12} />
                Saving to: <strong>{selectedThread.customer_name || `Customer #${selectedThread.customer_id}`}</strong>
              </div>
            )}
            {threadAttachments.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No attachments found in this thread.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">
                  Assign each attachment to a document slot. Attachments set to "Don't save" are skipped.
                </p>
                <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
                  {threadAttachments.map(att => {
                    const assignment = saveDocsAssignments[att.key] || {};
                    const docType    = assignment.doc_type || "";
                    return (
                      <div key={att.key} className="px-3 py-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <FileText size={12} className="text-gray-400 shrink-0" />
                          <span className="text-xs font-medium text-gray-700 truncate flex-1">{att.name}</span>
                          {att.size > 0 && (
                            <span className="text-[10px] text-gray-400 shrink-0">{Math.round(att.size / 1024)}KB</span>
                          )}
                        </div>
                        <select
                          value={docType}
                          onChange={e => {
                            const val  = e.target.value;
                            const opt  = val === "__skip__" ? null
                              : REQUIRED_DOC_TYPES.find(d => d.key === val);
                            setSaveDocsAssignments(prev => ({
                              ...prev,
                              [att.key]: { doc_type: val, label: opt?.label || val },
                            }));
                          }}
                          className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-300 ${
                            !docType ? "border-amber-300 bg-amber-50" : "border-gray-200"
                          }`}
                        >
                          <option value="">— assign to document slot —</option>
                          <option value="__skip__">Don't save this attachment</option>
                          <optgroup label="Standard document types">
                            {REQUIRED_DOC_TYPES.map(dt => (
                              <option key={dt.key} value={dt.key}>{dt.label}</option>
                            ))}
                          </optgroup>
                          <option value="custom">Custom label…</option>
                        </select>
                        {docType === "custom" && (
                          <input
                            type="text"
                            value={saveDocsCustomLabels[att.key] || ""}
                            onChange={e => setSaveDocsCustomLabels(prev => ({ ...prev, [att.key]: e.target.value }))}
                            placeholder="Enter a label for this document"
                            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-300"
                            autoFocus
                          />
                        )}
                        {docType && docType !== "__skip__" && docType !== "custom" && saveDocsExisting[docType] && (
                          <div className="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                            <AlertCircle size={11} className="shrink-0" />
                            Already on file: <span className="font-semibold truncate max-w-[160px]">{saveDocsExisting[docType].filename}</span> — will be replaced
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <BtnSecondary onClick={() => setSaveDocsOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary
                onClick={saveDocs}
                disabled={saveDocsSaving || !Object.values(saveDocsAssignments).some(v => v?.doc_type && v.doc_type !== "__skip__")}
              >
                {saveDocsSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save {Object.values(saveDocsAssignments).filter(v => v?.doc_type && v.doc_type !== "__skip__").length || ""} Documents
              </BtnPrimary>
            </div>
          </div>
        )}
      </Modal>}

      {/* Send Docs modal */}
      {sendDocsOpen && <Modal onClose={() => { setSendDocsOpen(false); setSendDocsCustQ(""); setSendDocsCustRes([]); }} title="Send Onboarding Documents">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Sends the full onboarding document pack from the onboarding mailbox. The customer's reply will auto-thread back into this inbox.
          </p>

          {/* Customer search — pick existing or leave blank to type manually */}
          <FormGroup label="Search existing customer (optional)">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={sendDocsCustQ}
                onChange={e => { setSendDocsCustQ(e.target.value); }}
                placeholder="Name or email — picks up their address automatically"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300"
                autoFocus
              />
              {sendDocsCustSearch && <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
            </div>
            {sendDocsCustRes.length > 0 && (
              <div className="mt-1 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-36 overflow-y-auto">
                {sendDocsCustRes.map(c => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSendDocsEmail(c.email || "");
                      setSendDocsCustName(c.name || "");
                      setSendDocsCustQ(c.name || "");
                      setSendDocsCustRes([]);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-bassani-50 transition-colors"
                  >
                    <span className="font-medium text-gray-800">{c.name}</span>
                    {c.email && <span className="text-xs text-gray-400 ml-2">{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </FormGroup>

          <FormGroup label="Recipient email address *">
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
            <BtnSecondary onClick={() => { setSendDocsOpen(false); setSendDocsCustQ(""); setSendDocsCustRes([]); }}>Cancel</BtnSecondary>
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
