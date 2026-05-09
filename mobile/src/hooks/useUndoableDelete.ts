/**
 * useUndoableDelete — orchestrates the 5-second undo window for soft
 * deletes from the Library. Owns the timer, the pending-row state, and
 * the optimistic delete/restore against Supabase via usePodcasts.
 *
 * Behavior:
 *   delete(podcast)  -> calls softDelete immediately, opens the banner
 *                       and starts a 5s countdown.
 *   undo()           -> stops the timer, calls restore() on the server,
 *                       closes the banner.
 *   commit (auto)    -> after 5s with no undo, the banner closes. The
 *                       server write is already permanent at this point.
 *
 * Stacking rule: triggering a second delete while one is open commits
 * the first (it's already permanent on the server) and replaces the
 * banner state with the new podcast. Simpler than queueing.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export const UNDO_WINDOW_MS = 5000;

interface PendingDelete {
  id: string;
  topic: string;
}

interface Args {
  softDelete: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
}

export function useUndoableDelete({ softDelete, restore }: Args) {
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const requestDelete = useCallback(
    (podcast: PendingDelete) => {
      clearTimer();
      setPending(podcast);
      void softDelete(podcast.id);
      timerRef.current = setTimeout(() => {
        setPending((curr) => (curr?.id === podcast.id ? null : curr));
        timerRef.current = null;
      }, UNDO_WINDOW_MS);
    },
    [clearTimer, softDelete],
  );

  const undo = useCallback(() => {
    if (!pending) return;
    clearTimer();
    const target = pending;
    setPending(null);
    void restore(target.id);
  }, [pending, restore, clearTimer]);

  const dismiss = useCallback(() => {
    clearTimer();
    setPending(null);
  }, [clearTimer]);

  return {
    pending,
    requestDelete,
    undo,
    dismiss,
  };
}
