import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);
const ICON = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle };

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const counter = useRef(0);
  const push = useCallback((text, kind = "ok") => {
    const id = ++counter.current;
    setItems((l) => [...l.filter((t) => t.text !== text).slice(-3), { id, text, kind }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.kind] || CheckCircle2;
          return <div key={t.id} className={`toast ${t.kind}`}><Icon size={18} aria-hidden="true" />{t.text}</div>;
        })}
      </div>
    </Ctx.Provider>
  );
}