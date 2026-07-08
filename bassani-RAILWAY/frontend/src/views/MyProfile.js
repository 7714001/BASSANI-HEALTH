import { useState, useEffect, useRef, useCallback } from "react";
import { User, KeyRound, PenLine, RotateCcw, Upload, CheckCircle, Trash2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { TopBar, Spinner, BtnPrimary, BtnDanger, FormGroup, Input, Badge } from "../components/UI";

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

export default function MyProfile() {
  const { can } = useAuth();
  const canSign = can("signing_authority.sign");

  const [profile,      setProfile    ] = useState(null);
  const [loading,      setLoading    ] = useState(true);

  // Personal info
  const [name,         setName       ] = useState("");
  const [infoSaving,   setInfoSaving ] = useState(false);

  // Password
  const [currentPw,   setCurrentPw  ] = useState("");
  const [newPw,        setNewPw      ] = useState("");
  const [confirmPw,    setConfirmPw  ] = useState("");
  const [pwSaving,     setPwSaving   ] = useState(false);

  // Signing authority
  const [signingName,  setSigningName ] = useState("");
  const [signingTitle, setSigningTitle] = useState("");
  const [sigMode,      setSigMode     ] = useState("draw");
  const [sigPreviewUrl,setSigPreviewUrl] = useState(null);
  const [uploadFile,   setUploadFile  ] = useState(null);
  const [sigSaving,    setSigSaving   ] = useState(false);
  const [deletingSig,  setDeletingSig ] = useState(false);

  // Canvas refs — captured at save time, no intermediate "pending" state
  const canvasRef  = useRef(null);
  const hasMark    = useRef(false);
  const isDrawing  = useRef(false);
  const fileRef    = useRef(null);

  // ── Canvas handlers ───────────────────────────────────────────────────────────

  // Size canvas to its actual rendered dimensions so coordinates match exactly.
  // Called on mount and on window resize so it stays correct if the layout shifts.
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
  }, []);

  // Map a pointer/touch event to canvas-space coordinates, accounting for scale.
  const getPos = useCallback((e, canvas) => {
    const rect   = canvas.getBoundingClientRect();
    const src    = e.touches ? e.touches[0] : e;
    const scaleX = canvas.width  / rect.width  / (window.devicePixelRatio || 1);
    const scaleY = canvas.height / rect.height / (window.devicePixelRatio || 1);
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top)  * scaleY,
    };
  }, []);

  const startDraw = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }, [getPos]);

  const draw = useCallback((e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();
    hasMark.current = true;
    e.preventDefault();
  }, [getPos]);

  const stopDraw = useCallback(() => { isDrawing.current = false; }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasMark.current = false;
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────────

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

  // Re-init canvas whenever the draw tab is visible or the window resizes.
  useEffect(() => {
    if (sigMode !== "draw") return;
    initCanvas();
    window.addEventListener("resize", initCanvas);
    return () => window.removeEventListener("resize", initCanvas);
  }, [sigMode, initCanvas]);

  // ── Save handlers ─────────────────────────────────────────────────────────────

  const saveInfo = async () => {
    setInfoSaving(true);
    try {
      await api.put("/api/profile/", { name });
      toast.success("Name updated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setInfoSaving(false);
    }
  };

  const changePassword = async () => {
    if (!currentPw || !newPw)   { toast.error("Fill in all password fields"); return; }
    if (newPw !== confirmPw)     { toast.error("New passwords do not match"); return; }
    if (newPw.length < 8)        { toast.error("Password must be at least 8 characters"); return; }
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

  // Single save for the whole signing authority section
  const saveSigningAuthority = async () => {
    setSigSaving(true);
    try {
      // Always persist the identity fields
      await api.put("/api/profile/", { signing_name: signingName, signing_title: signingTitle });

      // Upload new signature image if provided
      if (sigMode === "draw" && hasMark.current) {
        const dataUrl = canvasRef.current.toDataURL("image/png");
        const fd = new FormData();
        fd.append("signature_drawn", dataUrl);
        await api.post("/api/profile/signature", fd, { headers: { "Content-Type": "multipart/form-data" } });
        setSigPreviewUrl(dataUrl);
        setProfile(p => ({ ...p, has_signature: true, signing_name: signingName, signing_title: signingTitle }));
        clearCanvas();
      } else if (sigMode === "upload" && uploadFile) {
        const fd = new FormData();
        fd.append("signature_file", uploadFile);
        await api.post("/api/profile/signature", fd, { headers: { "Content-Type": "multipart/form-data" } });
        setSigPreviewUrl(URL.createObjectURL(uploadFile));
        setProfile(p => ({ ...p, has_signature: true, signing_name: signingName, signing_title: signingTitle }));
        setUploadFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        setProfile(p => ({ ...p, signing_name: signingName, signing_title: signingTitle }));
      }

      toast.success("Signing authority updated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
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
      setProfile(p => ({ ...p, has_signature: false }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove signature");
    } finally {
      setDeletingSig(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Profile" />
      <div className="flex items-center justify-center flex-1"><Spinner size="lg" /></div>
    </div>
  );

  const fullyConfigured = profile?.has_signature && profile?.signing_name && profile?.signing_title;
  const missing = [
    !profile?.signing_name  && "signing name",
    !profile?.signing_title && "signing title",
    !profile?.has_signature && "signature image",
  ].filter(Boolean);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="My Profile" subtitle="Personal settings and signature" />
      <main className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Left column ── */}
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
                  <div className="pt-1">
                    <BtnPrimary onClick={saveInfo} disabled={infoSaving}>
                      {infoSaving ? "Saving…" : "Save"}
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

              {/* Signing Authority — signing_authority.sign users only */}
              {canSign && (
                <div className="bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <PenLine size={15} className="text-bassani-600" />
                    <h2 className="text-sm font-semibold text-gray-900">Signing Authority</h2>
                  </div>
                  <p className="text-xs text-gray-400 mb-5">
                    Your name, title, and signature image are all required before you can countersign customer onboarding documents.
                  </p>

                  <div className="space-y-4">

                    {/* Identity fields */}
                    <FormGroup label="Signing Name" hint="Appears on countersigned documents">
                      <Input value={signingName} onChange={e => setSigningName(e.target.value)} placeholder="e.g. Rookshanna Hussain" />
                    </FormGroup>
                    <FormGroup label="Signing Title" hint="Your job title on countersigned documents">
                      <Input value={signingTitle} onChange={e => setSigningTitle(e.target.value)} placeholder="e.g. Responsible Pharmacist" />
                    </FormGroup>

                    {/* Signature image */}
                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-2">Signature Image</p>

                      {/* Existing signature preview */}
                      {sigPreviewUrl && (
                        <div className="mb-3 flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                          <div className="min-w-0">
                            <img src={sigPreviewUrl} alt="Current signature" className="max-h-10 max-w-[200px] object-contain" />
                            {profile?.signature_updated_at && (
                              <p className="text-[10px] text-gray-400 mt-1">
                                Updated {new Date(profile.signature_updated_at).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" })}
                              </p>
                            )}
                          </div>
                          <BtnDanger size="sm" onClick={deleteSignature} disabled={deletingSig}>
                            <Trash2 size={12} /> {deletingSig ? "Removing…" : "Remove"}
                          </BtnDanger>
                        </div>
                      )}

                      {/* Draw / Upload tabs */}
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <div className="flex border-b border-gray-100 bg-gray-50">
                          {[["draw", "Draw"], ["upload", "Upload Image"]].map(([m, label]) => (
                            <button
                              key={m}
                              onClick={() => { setSigMode(m); setUploadFile(null); clearCanvas(); if (fileRef.current) fileRef.current.value = ""; }}
                              className={`flex-1 py-2 text-xs font-medium transition-colors ${sigMode === m ? "bg-white text-bassani-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <div className="p-3">
                          {sigMode === "draw" ? (
                            <div className="space-y-2">
                              <canvas
                                ref={canvasRef}
                                className="w-full cursor-crosshair touch-none bg-white rounded-lg border border-gray-100"
                                style={{ height: 120 }}
                                onMouseDown={startDraw}
                                onMouseMove={draw}
                                onMouseUp={stopDraw}
                                onMouseLeave={stopDraw}
                                onTouchStart={startDraw}
                                onTouchMove={draw}
                                onTouchEnd={stopDraw}
                              />
                              <button
                                onClick={clearCanvas}
                                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                              >
                                <RotateCcw size={11} /> Clear
                              </button>
                            </div>
                          ) : (
                            <>
                              <input
                                type="file"
                                ref={fileRef}
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={e => { const f = e.target.files?.[0]; if (f) setUploadFile(f); }}
                              />
                              <button
                                onClick={() => fileRef.current?.click()}
                                className="flex items-center gap-2 w-full py-5 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-500 hover:border-bassani-300 hover:text-bassani-600 transition-colors justify-center"
                              >
                                <Upload size={13} />
                                {uploadFile ? uploadFile.name : "Choose PNG, JPG, or WebP"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Single save button for the whole section */}
                    <div className="pt-1">
                      <BtnPrimary onClick={saveSigningAuthority} disabled={sigSaving}>
                        {sigSaving ? "Saving…" : "Save Changes"}
                      </BtnPrimary>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right column — account details ── */}
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
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Signing Authority</p>
                      {fullyConfigured
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle size={10} /> Ready to countersign</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Incomplete</span>
                      }
                      {!fullyConfigured && (
                        <p className="text-[10px] text-gray-400 mt-1.5">Missing: {missing.join(", ")}</p>
                      )}
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
