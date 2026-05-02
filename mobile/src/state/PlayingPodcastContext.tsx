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

  const setCurrent = useCallback((next: PlayingPodcast | null) => {
    currentRef.current = next;
    setCurrentState(next);
  }, []);

  const load = useCallback(
    async (podcast: PlayingPodcast) => {
      if (currentRef.current?.id === podcast.id) {
        // Already loaded; keep playing position, ignore the call.
        if (!ready) setReady(true);
        return;
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
      }
      setReady(true);
    },
    [ready, setCurrent],
  );

  const clear = useCallback(async () => {
    setCurrent(null);
    setReady(false);
    await TrackPlayer.reset();
  }, [setCurrent]);

  return (
    <Context.Provider value={{ current, ready, load, clear }}>
      {children}
    </Context.Provider>
  );
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
