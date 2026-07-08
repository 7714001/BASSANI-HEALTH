import { useState, useEffect, useRef, useCallback } from "react";
import { User, KeyRound, PenLine, RotateCcw, Upload, CheckCircle, Trash2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { TopBar, Spinner, BtnPrimary, BtnSecondary, BtnDanger, FormGroup, Input, Badge } from "../components/UI";

const ROLE_LABELS = {
  super_admin:            "Super Admin",
  admin:                  "Admin",
  warehouse_supervisor:   "Warehouse Supervisor",
  packer:                 "Packer",
  sales:                  "Sales",
  orders_clerk:           "Orders Clerk",
  finance:                "Finance",
  qa_manager:             "QA Manager",
  responsible_pharmacist: "Responsible Pharmacist",
  reseller:               "Reseller",
};

// ── Signature pad (shared with SigningAuthority.js style) ─────────────────────

function SignaturePad({ onCapture, onClear }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const hasMark   = useRef(false);

  const getPos = useCallback((e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }, []);

  const startDraw = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }, [getPos]);

  const draw = useCallback((e) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.stroke();
    hasMark.current = true;
    e.preventDefault();
  }, [getPos]);

  const stopDraw = useCallback(() => { drawing.current = false; }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasMark.current = false;
    onClear?.();
  };

  const capture = () => {
    if (!hasMark.current) {
      toast.error("Draw your signature first");
      return;
    }
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onCapture(dataUrl);
  };

  return (
    <div className="space-y-2">
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <canvas
          ref={canvasRef}
          width={480}
          height={140}
          className="w-full cursor-crosshair touch-none"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={stopDraw}
        />
      </div>
      <div className="flex gap-2">
        <BtnSecondary size="sm" onClick={clear}>
          <RotateCcw size={12} /> Clear
        </BtnSecondary>
        <BtnPrimary size="sm" onClick={capture}>
          <CheckCircle size={12} /> Use this signature
        </BtnPrimary>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function MyProfile() {
  const { user: authUser, can } = useAuth();
  const canSign = can("signing_authority.sign");

  const [profile,       setProfile      ] = useState(null);
  const [loading,       setLoading      ] = useState(true);
  const [saving,        setSaving       ] = useState(false);

  // Personal info
  const [name,          setName         ] = useState("");
  const [signingName,   setSigningName  ] = useState("");
  const [signingTitle,  setSigningTitle ] = useState("");

  // Password change
  const [currentPw,    setCurrentPw    ] = useState("");
  const [newPw,        setNewPw        ] = useState("");
  const [confirmPw,    setConfirmPw    ] = useState("");
  const [pwSaving,     setPwSaving     ] = useState(false);

  // Signature
  const [sigMode,      setSigMode      ] = useState("draw");
  const [sigPreviewUrl,setSigPreviewUrl] = useState(null);
  const [sigPending,   setSigPending   ] = useState(null); // base64 or File
  const [sigSaving,    setSigSaving    ] = useState(false);
  const [deletingSig,  setDeletingSig  ] = useState(false);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/profile/");
      setProfile(data);
      setName(data.name || "");
      setSigningName(data.signing_name || "");
      setSigningTitle(data.signing_title || "");
      if (data.has_signature && canSign) {
        const res = await api.get("/api/profile/signature", { responseType: "blob" });
        setSigPreviewUrl(URL.createObjectURL(res.data));
      }
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [canSign]);

  useEffect(() => { load(); }, [load]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await api.put("/api/profile/", { name, signing_name: signingName, signing_title: signingTitle });
      toast.success("Profile updated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (!currentPw || !newPw) { toast.error("Fill in all password fields"); return; }
    if (newPw !== confirmPw)  { toast.error("New passwords do not match"); return; }
    if (newPw.length < 8)     { toast.error("Password must be at least 8 characters"); return; }
    setPwSaving(true);
    try {
      await api.post("/api/auth/change-password", { current_password: currentPw, new_password: newPw });
      toast.success("Password changed");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSigPending(file);
    setSigPreviewUrl(URL.createObjectURL(file));
  };

  const handleDrawCapture = (dataUrl) => {
    setSigPending(dataUrl);
    setSigPreviewUrl(dataUrl);
  };

  const saveSignature = async () => {
    if (!sigPending) { toast.error("No signature to save"); return; }
    setSigSaving(true);
    try {
      const fd = new FormData();
      if (sigPending instanceof File) {
        fd.append("signature_file", sigPending);
      } else {
        fd.append("signature_drawn", sigPending);
      }
      await api.post("/api/profile/signature", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Signature saved");
      setSigPending(null);
      setProfile(p => ({ ...p, has_signature: true }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save signature");
    } finally {
      setSigSaving(false);
    }
  };

  const deleteSignature = async () => {
    if (!window.confirm("Remove your signature? You will need to re-upload it before you can countersign documents.")) return;
    setDeletingSig(true);
    try {
      await api.delete("/api/profile/signature");
      toast.success("Signature removed");
      setSigPreviewUrl(null);
      setSigPending(null);
      setProfile(p => ({ ...p, has_signature: false }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove signature");
    } finally {
      setDeletingSig(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Profile" />
      <div className="flex items-center justify-center flex-1"><Spinner size="lg" /></div>
    </div>
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Profile" subtitle="Personal settings and signature" />
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left column */}
            <div className="lg:col-span-2 space-y-6">

              {/* Personal Information */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <User size={15} className="text-bassani-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Personal Information</h2>
                </div>
                <div className="space-y-4">
                  <FormGroup label="Display Name">
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
                  </FormGroup>
                  <FormGroup label="Username">
                    <Input value={profile?.username || ""} disabled className="bg-gray-50 text-gray-500" />
                  </FormGroup>
                  <FormGroup label="Email">
                    <Input value={profile?.email || ""} disabled className="bg-gray-50 text-gray-500" />
                  </FormGroup>
                  {canSign && (
                    <>
                      <FormGroup label="Signing Name" hint="Name that appears on countersigned documents">
                        <Input value={signingName} onChange={e => setSigningName(e.target.value)} placeholder="e.g. Rookshanna Hussain" />
                      </FormGroup>
                      <FormGroup label="Signing Title" hint="Job title that appears on countersigned documents">
                        <Input value={signingTitle} onChange={e => setSigningTitle(e.target.value)} placeholder="e.g. Responsible Pharmacist" />
                      </FormGroup>
                    </>
                  )}
                  <div className="pt-1">
                    <BtnPrimary onClick={saveProfile} disabled={saving}>
                      {saving ? "Saving…" : "Save Changes"}
                    </BtnPrimary>
                  </div>
                </div>
              </div>

              {/* Change Password */}
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <KeyRound size={15} className="text-bassani-600" />
                  <h2 className="text-sm font-semibold text-gray-900">Change Password</h2>
                </div>
                <div className="space-y-4">
                  <FormGroup label="Current Password">
                    <Input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} autoComplete="current-password" />
                  </FormGroup>
                  <FormGroup label="New Password">
                    <Input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} autoComplete="new-password" />
                  </FormGroup>
                  <FormGroup label="Confirm New Password">
                    <Input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} autoComplete="new-password" />
                  </FormGroup>
                  <div className="pt-1">
                    <BtnPrimary onClick={changePassword} disabled={pwSaving}>
                      {pwSaving ? "Changing…" : "Change Password"}
                    </BtnPrimary>
                  </div>
                </div>
              </div>

              {/* Signature — only for signing_authority.sign users */}
              {canSign && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <PenLine size={15} className="text-bassani-600" />
                    <h2 className="text-sm font-semibold text-gray-900">My Signature</h2>
                  </div>
                  <p className="text-xs text-gray-400 mb-4">
                    Your signature is used when you countersign customer onboarding documents. Upload a photo of your signature or draw one below.
                  </p>

                  {/* Current signature preview */}
                  {sigPreviewUrl && (
                    <div className="mb-4 border border-gray-100 rounded-xl p-3 bg-gray-50 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Current Signature</p>
                        <img
                          src={sigPreviewUrl}
                          alt="Signature preview"
                          className="max-h-16 max-w-xs object-contain"
                        />
                        {profile?.signature_updated_at && (
                          <p className="text-[10px] text-gray-400 mt-1.5">
                            Updated {new Date(profile.signature_updated_at).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
                          </p>
                        )}
                      </div>
                      <BtnDanger size="sm" onClick={deleteSignature} disabled={deletingSig}>
                        <Trash2 size={12} /> {deletingSig ? "Removing…" : "Remove"}
                      </BtnDanger>
                    </div>
                  )}

                  {/* Mode selector */}
                  <div className="flex gap-2 mb-3">
                    {["draw", "upload"].map(m => (
                      <button
                        key={m}
                        onClick={() => { setSigMode(m); setSigPending(null); if (!profile?.has_signature) setSigPreviewUrl(null); }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${sigMode === m ? "bg-bassani-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                      >
                        {m === "draw" ? "Draw" : "Upload Image"}
                      </button>
                    ))}
                  </div>

                  {sigMode === "draw" ? (
                    <SignaturePad onCapture={handleDrawCapture} onClear={() => { if (!profile?.has_signature) setSigPreviewUrl(null); }} />
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="file"
                        ref={fileRef}
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={handleFileSelect}
                      />
                      <button
                        onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-500 hover:border-bassani-300 hover:text-bassani-600 transition-colors w-full justify-center"
                      >
                        <Upload size={14} />
                        {sigPending instanceof File ? sigPending.name : "Choose an image (PNG, JPG, WebP)"}
                      </button>
                    </div>
                  )}

                  {sigPending && (
                    <div className="mt-3">
                      <BtnPrimary onClick={saveSignature} disabled={sigSaving}>
                        {sigSaving ? "Saving…" : "Save Signature"}
                      </BtnPrimary>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right column — account details */}
            <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Account Details</h2>
                <div className="space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Role</p>
                    <Badge color={profile?.is_super_admin ? "purple" : "blue"}>
                      {profile?.is_super_admin ? "Super Admin" : (ROLE_LABELS[profile?.role] || profile?.role || "—")}
                    </Badge>
                  </div>
                  {canSign && (
                    <div>
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Signature Status</p>
                      {profile?.has_signature
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle size={10} /> Configured</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Not configured</span>
                      }
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
