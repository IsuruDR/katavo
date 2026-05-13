/**
 * pendingPodcasts — tiny module-level store for optimistic Podcast rows.
 *
 * Cross-instance seam between Generate (which writes a row the moment
 * submitPodcast resolves) and Library's usePodcasts (which merges these
 * into the rendered list). When the real server row arrives — via
 * Supabase realtime INSERT or a refetch — the matching pending entry is
 * cleared by id and the optimistic row disappears in place of the real
 * one.
 *
 * No React Context needed: keys are podcast ids, so multiple hook
 * instances reading the same store de-duplicate naturally.
 */
import type { Podcast } from "../hooks/usePodcasts";

type Listener = () => void;

const pending = new Map<string, Podcast>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function emitPending(podcast: Podcast): void {
  pending.set(podcast.id, podcast);
  notify();
}

export function clearPending(id: string): void {
  if (pending.delete(id)) notify();
}

export function getPending(): Podcast[] {
  return Array.from(pending.values());
}

export function subscribePending(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
