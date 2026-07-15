import { useState, useEffect, useRef, useCallback } from "react";
import {
  PenLine, Upload, CheckCircle, Loader2, RefreshCw,
  User, Briefcase, MapPin, Eye, Trash2,
} from "lucide-react";
import { BtnPrimary, BtnSecondary, FormGroup, Modal } from "../components/UI";
import api from "../api";
import toast from "react-hot-toast";

// ── Canvas drawing hook ────────────────────────────────────────────────────────
function useDrawCanvas(canvasRef) {
  const drawing  = useRef(false);
  const lastPos  = useRef(null);
  const hasDrawn = useRef(false);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const start = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
  }, [canvasRef]);

  const move = useCallback((e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext("2d");
    const pos  = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth   = 2.2;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();
    lastPos.current  = pos;
    hasDrawn.current = true;
  }, [canvasRef]);

  const stop = useCallback(() => { drawing.current = false; }, []);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
  }, [canvasRef]);

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn.current) return null;
    // Export with transparent background — white canvas becomes transparent
    const offscreen = document.createElement("canvas");
    offscreen.width  = canvas.width;
    offscreen.height = canvas.height;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(canvas, 0, 0);
    return offscreen.toDataURL("image/png");
  }, [canvasRef]);

  return { start, move, stop, clear, exportPng, hasDrawn };
}

// ── Background removal ─────────────────────────────────────────────────────────
function removeBackground(imgEl, threshold = 220) {
  const canvas = document.createElement("canvas");
  canvas.width  = imgEl.naturalWidth  || imgEl.width;
  canvas.height = imgEl.naturalHeight || imgEl.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgEl, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luminance > threshold) {
      data[i + 3] = 0; // make transparent
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

// ── Draw tab ───────────────────────────────────────────────────────────────────
function DrawTab({ onCapture }) {
  const canvasRef = useRef(null);
  const { start, move, stop, clear, exportPng, hasDrawn } = useDrawCanvas(canvasRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const handleUse = () => {
    const png = exportPng();
    if (!png) return toast.error("Draw your signature first");
    onCapture(png);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Draw your signature below using your mouse or finger. Use smooth, continuous strokes
        for the best result. A photographed signature will typically look better on documents.
      </p>
      <div className="relative border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={560}
          height={180}
          className="w-full touch-none cursor-crosshair"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={stop}
        />
        <div className="absolute bottom-2 right-2 pointer-events-none">
          <span className="text-xs text-gray-200 select-none">Sign here</span>
        </div>
      </div>
      <div className="flex gap-2">
        <BtnSecondary onClick={clear} size="sm">
          <Trash2 size={13} /> Clear
        </BtnSecondary>
        <BtnPrimary onClick={handleUse} size="sm">
          Use this signature
        </BtnPrimary>
      </div>
    </div>
  );
}

// ── Upload tab ─────────────────────────────────────────────────────────────────
function UploadTab({ onCapture }) {
  const [preview,   setPreview  ] = useState(null);  // original data URL
  const [cleaned,   setCleaned  ] = useState(null);  // bg-removed data URL
  const [bgRemove,  setBgRemove ] = useState(true);
  const [threshold, setThreshold] = useState(220);
  const imgRef  = useRef(null);
  const fileRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setPreview(ev.target.result);
      setCleaned(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const applyRemoval = useCallback(() => {
    if (!imgRef.current || !preview) return;
    const result = removeBackground(imgRef.current, threshold);
    setCleaned(result);
  }, [preview, threshold]);

  const handleUse = () => {
    const src = bgRemove ? (cleaned || preview) : preview;
    if (!src) return toast.error("Upload an image first");
    onCapture(src);
  };

  const displaySrc = bgRemove ? (cleaned || preview) : preview;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Sign your name on plain white paper with a dark pen. Take a clear photo or scan it,
        then upload it here. The background can be automatically removed so the signature
        sits cleanly on documents.
      </p>

      {/* Drop zone */}
      <div
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
          preview
            ? "border-bassani-300 bg-bassani-50/30"
            : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"
        }`}
      >
        {preview ? (
          <div className="space-y-1">
            <p className="text-xs text-bassani-600 font-medium">Click to replace</p>
          </div>
        ) : (
          <>
            <Upload size={20} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Click to upload a photo or scan</p>
            <p className="text-xs text-gray-400 mt-1">PNG, JPG, WebP — max 5 MB</p>
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* Hidden img for pixel access */}
      {preview && (
        <img
          ref={imgRef}
          src={preview}
          alt=""
          className="hidden"
          crossOrigin="anonymous"
          onLoad={applyRemoval}
        />
      )}

      {/* Preview */}
      {preview && (
        <div className="space-y-3">
          <div
            className="rounded-xl overflow-hidden border border-gray-100"
            style={{
              background: bgRemove
                ? "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 16px 16px"
                : "#fff",
            }}
          >
            <img
              src={displaySrc || preview}
              alt="Signature preview"
              className="max-h-40 mx-auto object-contain py-4 px-6"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={bgRemove}
                onChange={e => {
                  setBgRemove(e.target.checked);
                  if (e.target.checked && !cleaned) applyRemoval();
                }}
                className="rounded"
              />
              Remove white background
            </label>
            {bgRemove && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Sensitivity</span>
                <input
                  type="range"
                  min={160}
                  max={250}
                  value={threshold}
                  onChange={e => {
                    setThreshold(Number(e.target.value));
                    setCleaned(null);
                  }}
                  onMouseUp={applyRemoval}
                  onTouchEnd={applyRemoval}
                  className="w-24 accent-bassani-600"
                />
                <span className="text-xs text-gray-400 w-6">{threshold}</span>
              </div>
            )}
            <button
              onClick={applyRemoval}
              className="text-xs text-bassani-600 hover:underline"
            >
              <RefreshCw size={11} className="inline mr-1" />
              Re-apply
            </button>
          </div>

          <BtnPrimary onClick={handleUse} size="sm">
            Use this signature
          </BtnPrimary>
        </div>
      )}
    </div>
  );
}

// ── Signature preview card ─────────────────────────────────────────────────────
function SignaturePreviewCard({ sigSrc, name, title, location, holderName, onReplace }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle size={16} className="text-green-500" />
          <span className="text-sm font-semibold text-gray-800">Signing authority configured</span>
        </div>
        <BtnSecondary size="sm" onClick={onReplace}>
          <RefreshCw size={13} /> Replace
        </BtnSecondary>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
            <User size={9} /> Name on documents
          </p>
          <p className="text-xs font-medium text-gray-700">{name || "—"}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
            <Briefcase size={9} /> Title
          </p>
          <p className="text-xs font-medium text-gray-700">{title || "—"}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
            <MapPin size={9} /> Signing location
          </p>
          <p className="text-xs font-medium text-gray-700">{location || "—"}</p>
        </div>
        <div className="bg-gray-50 rounded-xl px-3 py-2">
          <p className="text-[10px] text-gray-400 mb-0.5 flex items-center gap-1">
            <User size={9} /> Portal countersigning user
          </p>
          <p className="text-xs font-medium text-gray-700">{holderName || <span className="text-amber-600">Not set (super admins only)</span>}</p>
        </div>
      </div>

      <div>
        <p className="text-[10px] text-gray-400 mb-2 uppercase tracking-wider">Signature preview</p>
        <div
          className="border border-gray-100 rounded-xl overflow-hidden"
          style={{
            background: "repeating-conic-gradient(#e5e7eb 0% 25%, #fff 0% 50%) 0 0 / 16px 16px",
          }}
        >
          <img
            src={sigSrc}
            alt="Stored signature"
            className="max-h-28 mx-auto object-contain py-4 px-8"
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">
          Checkerboard shows transparency — the signature will appear as dark ink on white document pages.
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs text-blue-700">
          Bassani's name and title are auto-filled on the customer's copy when they sign. The countersigning user completes the Bassani signature block when approving the application in the portal.
        </p>
      </div>
    </div>
  );
}

// ── Setup / Replace modal ──────────────────────────────────────────────────────
function SetupModal({ existing, onClose, onSaved }) {
  const [tab,          setTab        ] = useState("upload");
  const [captured,     setCaptured   ] = useState(null);  // data-URL from draw or upload tab
  const [name,         setName       ] = useState(existing?.name          || "");
  const [title,        setTitle      ] = useState(existing?.title         || "");
  const [location,     setLocation   ] = useState(existing?.location      || "");
  const [holderUserId, setHolderUserId] = useState(existing?.holder_user_id || "");
  const [holderName,   setHolderName  ] = useState(existing?.holder_name   || "");
  const [users,        setUsers       ] = useState([]);
  const [saving,       setSaving      ] = useState(false);

  useEffect(() => {
    api.get("/api/users/")
      .then(r => {
        const STAFF_ROLES = new Set(["super_admin", "admin", "sales", "finance", "orders_clerk", "qa_manager", "responsible_pharmacist"]);
        setUsers((r.data.users || []).filter(u => STAFF_ROLES.has(u.role)));
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!name.trim())     return toast.error("Full name is required");
    if (!title.trim())    return toast.error("Title is required");
    if (!location.trim()) return toast.error("Signing location is required");
    if (!captured && !existing?.has_signature) return toast.error("Signature is required");

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("name",     name.trim());
      fd.append("title",    title.trim());
      fd.append("location", location.trim());
      if (holderUserId) {
        fd.append("holder_user_id", holderUserId);
        fd.append("holder_name",    holderName);
      }

      if (captured) {
        // Convert data URL to blob
        const res  = await fetch(captured);
        const blob = await res.blob();
        fd.append("signature_file", blob, "signature.png");
      }

      await api.post("/api/signing-authority/", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success("Signing authority saved");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={existing ? "Replace signing authority" : "Set up signing authority"}
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="space-y-5">
        {/* Profile fields */}
        <div className="grid grid-cols-3 gap-3">
          <FormGroup label="Full name" required>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Mike Stringer"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-bassani-500"
            />
          </FormGroup>
          <FormGroup label="Title / Position" required>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Chief Executive Officer"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-bassani-500"
            />
          </FormGroup>
          <FormGroup label="Signing location" required>
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="Cape Town"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-bassani-500"
            />
          </FormGroup>
        </div>

        {/* Portal countersigning user */}
        <FormGroup label="Portal countersigning user">
          <select
            value={holderUserId}
            onChange={e => {
              const uid = e.target.value;
              setHolderUserId(uid);
              const u = users.find(u => u.id === uid);
              setHolderName(u ? (u.name || u.username || "") : "");
            }}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-bassani-500 bg-white"
          >
            <option value="">— Select the user who will countersign applications —</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.name || u.username} ({u.role})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">
            This is the portal login that will see the Countersign button on application reviews. Super admins always have access regardless of this setting.
          </p>
        </FormGroup>

        {/* Signature section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-700">
              Signature
              {existing?.has_signature && !captured && (
                <span className="ml-2 text-xs text-green-600 font-normal">
                  (current signature kept if left unchanged)
                </span>
              )}
            </p>
            {/* Tab switcher */}
            <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setTab("upload")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  tab === "upload"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <Upload size={11} className="inline mr-1" />
                Upload photo
              </button>
              <button
                onClick={() => setTab("draw")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  tab === "draw"
                    ? "bg-white text-gray-800 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                <PenLine size={11} className="inline mr-1" />
                Draw in app
              </button>
            </div>
          </div>

          {/* Captured preview strip */}
          {captured && (
            <div className="mb-3 flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-4 py-2">
              <CheckCircle size={14} className="text-green-500 shrink-0" />
              <img
                src={captured}
                alt="Captured signature"
                className="h-10 object-contain"
                style={{ background: "transparent" }}
              />
              <button
                onClick={() => setCaptured(null)}
                className="ml-auto text-xs text-gray-400 hover:text-red-500"
              >
                Remove
              </button>
            </div>
          )}

          <div className="border border-gray-100 rounded-xl p-4 bg-gray-50/50">
            {tab === "upload"
              ? <UploadTab onCapture={setCaptured} />
              : <DrawTab   onCapture={setCaptured} />
            }
          </div>
        </div>

        {/* Preview how it looks */}
        {captured && (
          <div className="border border-gray-100 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3 flex items-center gap-1.5">
              <Eye size={12} /> Preview — how this will appear on a signed document
            </p>
            <div className="bg-white border border-gray-200 rounded-lg px-6 py-5 font-serif text-sm text-gray-700 space-y-3">
              <div className="flex gap-8 text-xs text-gray-500">
                <span><strong>Signed at</strong> {location || "Cape Town"}</span>
                <span><strong>on</strong> {new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" })}</span>
              </div>
              <div>
                <img
                  src={captured}
                  alt="Signature"
                  className="h-14 object-contain"
                  style={{ mixBlendMode: "multiply" }}
                />
              </div>
              <div className="border-t border-gray-200 pt-2 text-xs">
                <strong>{name || "Full Name"}</strong>
                <span className="ml-2 text-gray-400">{title || "Title"}</span>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
            {existing ? "Save changes" : "Save signing authority"}
          </BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}

// ── Section component — embedded inside DocumentTemplates page ─────────────────
export function SigningAuthoritySection() {
  const [loading,    setLoading   ] = useState(true);
  const [profile,    setProfile   ] = useState(null);
  const [sigSrc,     setSigSrc    ] = useState(null);
  const [modalOpen,  setModalOpen ] = useState(false);
  const [sigLoading, setSigLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/signing-authority/");
      if (res.data.configured) {
        setProfile(res.data.profile);
        loadSig();
      } else {
        setProfile(null);
      }
    } catch {
      toast.error("Failed to load signing authority");
    } finally {
      setLoading(false);
    }
  };

  const loadSig = async () => {
    setSigLoading(true);
    try {
      const res = await api.get("/api/signing-authority/signature", { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      setSigSrc(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch {
      // not configured yet
    } finally {
      setSigLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  if (loading || sigLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-bassani-600" />
      </div>
    );
  }

  return (
    <>
      {profile && sigSrc ? (
        <SignaturePreviewCard
          sigSrc={sigSrc}
          name={profile.name}
          title={profile.title}
          location={profile.location}
          holderName={profile.holder_name}
          onReplace={() => setModalOpen(true)}
        />
      ) : (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-10 text-center">
          <PenLine size={28} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-700 mb-1">No signing authority configured</p>
          <p className="text-xs text-gray-400 mb-5 max-w-sm mx-auto">
            Co-signed documents cannot be issued until this is set up.
            Upload a photo of your handwritten signature or draw it in the app.
          </p>
          <BtnPrimary onClick={() => setModalOpen(true)}>
            <PenLine size={14} /> Set up signing authority
          </BtnPrimary>
        </div>
      )}

      {modalOpen && (
        <SetupModal
          existing={profile}
          onClose={() => setModalOpen(false)}
          onSaved={() => { load(); setModalOpen(false); }}
        />
      )}
    </>
  );
}
