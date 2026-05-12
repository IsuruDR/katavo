// mobile/src/state/PlayingPodcastContext.tsx
/**
 * PlayingPodcastContext — global "what's loaded into TrackPlayer" state.
 *
 * Lifted out of the player screen so audio survives navigation. The
 * provider owns track loading and reset; player screen and PodcastRow
 * call into `load`. MiniPlayer subscribes to render the persistent bar.
 *
 * `current` and `ready` are state for re-rendering subscribers; a
 * mirrored ref backs synchronous comparisons inside async callbacks.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import TrackPlayer from "react-native-track-player";
import { loadTrack, setupPlayer } from "../services/player";

export interface PlayingPodcast {
  id: string;
  topic: string;
  audioUrl: string;
  coverUrl: string | null;
  durationSeconds: number | null;
  chapterMarkers: Array<{ timestampSeconds: number; title: string }>;
}

interface ContextValue {
  current: PlayingPodcast | null;
  ready: boolean;
  load: (podcast: PlayingPodcast) => Promise<void>;
  clear: () => Promise<void>;
}

const Context = createContext<ContextValue | null>(null);

export function PlayingPodcastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrentState] = useState<PlayingPodcast | null>(null);
  const [ready, setReady] = useState(false);
  const currentRef = useRef<PlayingPodcast | null>(null);
  // In-memory cache of last-known playback position per podcast id.
  // Lets users pop back from an expansion to the parent (or vice versa)
  // and resume where they left off, instead of having loadTrack reset to 0.
  // Session-scoped — cleared on app restart, which is the right ergonomic.
  const positionsByIdRef = useRef<Map<string, number>>(new Map());

  const setCurrent = useCallback((next: PlayingPodcast | null) => {
    currentRef.current = next;
    setCurrentState(next);
  }, []);

  const load = useCallback(
    async (podcast: PlayingPodcast) => {
      if (currentRef.current?.id === podcast.id) {
        // Already loaded; keep playing position, ignore the call.
        // setReady(true) is idempotent — calling it when ready is already
        // true is a no-op for React, so we don't need `ready` in deps
        // (which would re-create this callback on every ready flip and
        // cascade re-fires into every consumer with `[load]` deps).
        setReady(true);
        return;
      }

      // Capture outgoing track's position before TrackPlayer.reset() wipes it.
      // Swallow errors — if the player isn't ready or progress is unavailable,
      // we lose this session's resume point for that track but don't crash.
      const outgoingId = currentRef.current?.id;
      if (outgoingId) {
        try {
          const { position } = await TrackPlayer.getProgress();
          if (position > 0) {
            positionsByIdRef.current.set(outgoingId, position);
          }
        } catch {
          // intentionally ignored
        }
      }

      setReady(false);
      setCurrent(podcast);
      await setupPlayer();
      if (podcast.audioUrl) {
        await loadTrack(
          podcast.id,
          podcast.audioUrl,
          podcast.topic,
          podcast.coverUrl,
        );
        const cached = positionsByIdRef.current.get(podcast.id);
        if (cached && cached > 0) {
          try {
            await TrackPlayer.seekTo(cached);
          } catch {
            // intentionally ignored — playback just starts from 0
          }
        }
      }
      setReady(true);
    },
    [setCurrent],
  );

  const clear = useCallback(async () => {
    // Capture outgoing position so a subsequent load() can resume.
    const outgoingId = currentRef.current?.id;
    if (outgoingId) {
      try {
        const { position } = await TrackPlayer.getProgress();
        if (position > 0) {
          positionsByIdRef.current.set(outgoingId, position);
        }
      } catch {
        // intentionally ignored
      }
    }
    setCurrent(null);
    setReady(false);
    await TrackPlayer.reset();
  }, [setCurrent]);

  // Memoized so a re-render that doesn't actually change current/ready/load
  // doesn't break referential equality for consumers. Without this, every
  // re-render of the provider hands out a fresh value object, which
  // re-fires every useEffect that depends on context fields and triggers
  // a re-render loop when two player screens are stacked (parent under
  // expansion). Each one calls `load(theirPodcast)` whenever load identity
  // changes, clobbering currentRef in a tight loop.
  const value = useMemo(
    () => ({ current, ready, load, clear }),
    [current, ready, load, clear],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePlayingPodcast() {
  const value = useContext(Context);
  if (!value) {
    throw new Error(
      "usePlayingPodcast must be used inside a PlayingPodcastProvider",
    );
  }
  return value;
}
