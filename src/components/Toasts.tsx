import { store } from '../store/store';
import { useStore } from '../hooks/useStore';

/** Transient feedback region, announced politely to screen readers. */
export function Toasts() {
  const state = useStore();

  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {state.toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          onClick={() => store.dismissToast(toast.id)}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}
