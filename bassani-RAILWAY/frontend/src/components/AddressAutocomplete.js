import { useState, useEffect, useRef, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";
import api from "../api";

/**
 * Address autocomplete input backed by Google Places (proxied through our
 * backend so the API key is never exposed to the browser).
 *
 * Props:
 *   value          — controlled value for the street field (string)
 *   onChange(str)  — called on every keystroke with the new street string
 *   onAddressSelect({ street, suburb, city, province, postal_code })
 *                  — called once when the user picks a suggestion; parent
 *                    should spread these into its form state
 *   placeholder    — input placeholder text
 *   autoFocus      — passed through to the input
 *
 * Degrades silently to a plain text input if the API is not configured (503).
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onAddressSelect,
  placeholder = "Start typing your address…",
  autoFocus = false,
}) {
  const [predictions,     setPredictions    ] = useState([]);
  const [loadingAuto,     setLoadingAuto    ] = useState(false);
  const [loadingDetails,  setLoadingDetails ] = useState(false);
  const [activeIndex,     setActiveIndex    ] = useState(-1);
  const [disabled,        setDisabled       ] = useState(false); // true if backend returns 503

  const containerRef  = useRef(null);
  const sessionToken  = useRef(crypto.randomUUID());

  const resetSession = () => { sessionToken.current = crypto.randomUUID(); };

  // ── Fetch predictions (debounced via useEffect) ───────────────────────────

  useEffect(() => {
    if (disabled || value.trim().length < 2) {
      setPredictions([]);
      return;
    }

    setActiveIndex(-1);
    const timer = setTimeout(async () => {
      setLoadingAuto(true);
      try {
        const { data } = await api.get("/api/public/places/autocomplete", {
          params: { q: value, session_token: sessionToken.current },
        });
        setPredictions(data.predictions || []);
      } catch (err) {
        if (err.response?.status === 503) setDisabled(true); // key not configured
        setPredictions([]);
      } finally {
        setLoadingAuto(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [value, disabled]);

  // ── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setPredictions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Select a prediction ───────────────────────────────────────────────────

  const handleSelect = useCallback(async (prediction) => {
    // Immediately close the dropdown and show street text optimistically
    const streetGuess = prediction.description.split(",")[0];
    onChange(streetGuess);
    setPredictions([]);
    setLoadingDetails(true);

    try {
      const { data } = await api.get("/api/public/places/details", {
        params: { place_id: prediction.place_id, session_token: sessionToken.current },
      });
      resetSession(); // new billing session for the next search
      // street may come back empty if Google doesn't return street_number
      onChange(data.street || streetGuess);
      onAddressSelect(data);
    } catch {
      // details failed — at least the street text is already set
    } finally {
      setLoadingDetails(false);
    }
  }, [onChange, onAddressSelect]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const handleKeyDown = (e) => {
    if (!predictions.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, predictions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(predictions[activeIndex]);
    } else if (e.key === "Escape") {
      setPredictions([]);
      setActiveIndex(-1);
    }
  };

  const isLoading = loadingAuto || loadingDetails;
  const showDropdown = predictions.length > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* Input */}
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
            focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white
            placeholder-gray-400 pr-8"
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
          {isLoading
            ? <Loader2 size={14} className="animate-spin" />
            : <MapPin size={14} />}
        </span>
      </div>

      {/* Predictions dropdown */}
      {showDropdown && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border
          border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <ul role="listbox">
            {predictions.map((p, i) => (
              <li
                key={p.place_id}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(p); }}
                onMouseEnter={() => setActiveIndex(i)}
                className={`px-3 py-2.5 text-sm cursor-pointer flex items-start gap-2
                  ${i === activeIndex ? "bg-bassani-50 text-bassani-700" : "text-gray-700 hover:bg-gray-50"}`}
              >
                <MapPin size={13} className="shrink-0 mt-0.5 text-gray-400" />
                <span>{p.description}</span>
              </li>
            ))}
          </ul>
          <div className="px-3 py-1.5 border-t border-gray-100 flex justify-end">
            <span className="text-[10px] text-gray-400">Powered by Google</span>
          </div>
        </div>
      )}
    </div>
  );
}
