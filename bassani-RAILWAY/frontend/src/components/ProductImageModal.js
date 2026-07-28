import { useState, useRef, useEffect } from "react";
import { Upload, Trash2, Loader2, Package } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { Modal, BtnPrimary, BtnSecondary, BtnDanger } from "./UI";

const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

export default function ProductImageModal({ product, onClose, onUpdated }) {
  const fileRef = useRef(null);
  const [file,          setFile         ] = useState(null);
  const [previewUrl,    setPreviewUrl   ] = useState(null);
  const [uploading,     setUploading    ] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [removing,      setRemoving     ] = useState(false);

  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickFile = (f) => {
    if (!f) return;
    if (!ACCEPTED.includes(f.type)) return toast.error("Only JPEG, PNG, or WEBP images are accepted");
    if (f.size > MAX_BYTES) return toast.error("Image must be under 8MB");
    setFile(f);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post(`/api/products/${product.id}/image`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Product image updated");
      onUpdated(r.data.image_128 || null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setRemoveConfirm(false);
    try {
      await api.delete(`/api/products/${product.id}/image`);
      toast.success("Product image removed");
      onUpdated(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to remove image");
      setRemoving(false);
    }
  };

  const hasCurrentImage = !!product?.image_128;

  return (
    <Modal title="Manage Product Image" onClose={onClose} width="max-w-md">

      <div className="mb-4 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500 mb-0.5">Product</p>
        <p className="text-sm font-semibold text-gray-900">{product.name}</p>
        {product.default_code && <p className="text-xs text-gray-400 font-mono mt-0.5">{product.default_code}</p>}
      </div>

      <div onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center gap-3 ${file ? "border-bassani-400 bg-bassani-50" : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"}`}>
        {previewUrl ? (
          <img src={previewUrl} alt="" className="w-28 h-28 rounded-lg object-cover border border-gray-200" />
        ) : hasCurrentImage ? (
          <img src={`data:image/png;base64,${product.image_128}`} alt="" className="w-28 h-28 rounded-lg object-cover border border-gray-200" />
        ) : (
          <div className="w-28 h-28 rounded-lg bg-gray-100 flex items-center justify-center text-gray-300">
            <Package size={28} />
          </div>
        )}
        {file ? (
          <p className="text-sm font-medium text-bassani-700">{file.name}</p>
        ) : (
          <>
            <Upload size={18} className="text-gray-300" />
            <p className="text-sm text-gray-500">Click to select a new image</p>
          </>
        )}
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={e => pickFile(e.target.files?.[0] || null)} />
      </div>
      <p className="text-xs text-gray-400 mt-2">JPEG, PNG, or WEBP. Max 8MB.</p>

      {removeConfirm && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800 mb-2">Remove the current image from <strong>{product.name}</strong>?</p>
          <div className="flex gap-2 justify-end">
            <BtnSecondary onClick={() => setRemoveConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={remove}>Remove image</BtnDanger>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mt-5 pt-3 border-t border-gray-100">
        {hasCurrentImage && !file ? (
          <button onClick={() => setRemoveConfirm(true)} disabled={removing}
            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors flex items-center gap-1">
            {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Remove image
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <BtnSecondary onClick={onClose}>Close</BtnSecondary>
          <BtnPrimary onClick={upload} disabled={!file || uploading} loading={uploading}>Upload</BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
