import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// Shared dialog: Esc and backdrop close it, Tab stays inside, focus returns to the opener.
export default function Modal({ title, subtitle, onClose, children, wide = false }) {
  const box = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    const focusable = () => [...box.current.querySelectorAll("input:not([type=hidden]):not(:disabled), select:not(:disabled), button:not(:disabled), textarea:not(:disabled)")];
    const first = box.current.querySelector("input:not([type=hidden]), select");
    (first || focusable()[0])?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const f = focusable();
      if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (opener && opener.focus) opener.focus();
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="modal-h">
          <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
