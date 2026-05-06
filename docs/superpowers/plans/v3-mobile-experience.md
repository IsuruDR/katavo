# Plan 3: Mobile App — React Native Screens & Audio Player

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete React Native mobile app with auth, podcast library, topic generation flow, audio player with chapter markers, and subscription management.

**Architecture:** Expo managed workflow with Expo Router for navigation. Supabase JS client for auth, data, and real-time subscriptions. react-native-track-player for background audio playback with lock screen controls. RevenueCat SDK for in-app purchases.

**Tech Stack:** React Native, Expo (managed), TypeScript, Expo Router, Supabase JS, react-native-track-player, RevenueCat, expo-notifications

**Spec reference:** `docs/superpowers/specs/2026-03-27-ai-podcast-app-design.md` — Sections 2, 3.2, 9

**Depends on:** Plan 1 (Foundation) — Supabase schema and Edge Functions must be in place.

---

## File Structure

```
mobile/
├── app/
│   ├── _layout.tsx                # Root layout with auth guard
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx            # Tab navigator
│   │   ├── index.tsx              # Home / Library
│   │   ├── generate.tsx           # Generate podcast
│   │   ├── sources.tsx            # Trusted Sources (Pro)
│   │   └── account.tsx            # Account / Subscription
│   └── player/
│       └── [id].tsx               # Podcast player screen
├── src/
│   ├── components/
│   │   ├── PodcastCard.tsx        # Library list item
│   │   ├── ClarifyingChat.tsx     # Q&A chat for topic refinement
│   │   ├── AudioPlayer.tsx        # Player controls component
│   │   ├── ChapterMarkers.tsx     # Tappable chapter list
│   │   ├── CreditBalance.tsx      # Credit display + buy button
│   │   └── LoadingOverlay.tsx     # Loading states
│   ├── hooks/
│   │   ├── useAuth.ts             # Auth state hook
│   │   ├── useSubscription.ts     # Subscription + credits hook
│   │   ├── usePodcasts.ts         # Podcast list with realtime
│   │   ├── usePlayer.ts           # Audio player state
│   │   └── usePushNotifications.ts
│   ├── services/
│   │   ├── podcast.ts             # Generate questions, submit podcast
│   │   ├── subscription.ts        # Credit purchases, tier info
│   │   └── player.ts              # Track player setup
│   ├── lib/
│   │   └── supabase.ts            # (from Plan 1)
│   └── types/
│       ├── database.ts            # (from Plan 1)
│       └── index.ts               # App-level types
├── app.json
├── tsconfig.json
└── package.json
```

---

## Chunk 1: Auth & Navigation Shell

### Task 1: Set up Expo Router with auth guard

**Files:**
- Create: `mobile/app/_layout.tsx`
- Create: `mobile/app/(auth)/_layout.tsx`
- Create: `mobile/app/(auth)/sign-in.tsx`
- Create: `mobile/app/(auth)/sign-up.tsx`
- Create: `mobile/app/(tabs)/_layout.tsx`
- Create: `mobile/src/hooks/useAuth.ts`

- [ ] **Step 1: Install Expo Router**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile"
npx expo install expo-router expo-linking expo-status-bar
```

- [ ] **Step 2: Create auth hook**

```typescript
// mobile/src/hooks/useAuth.ts
import { useState, useEffect, useCallback } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  return { session, user, loading, signIn, signUp, signOut };
}
```

- [ ] **Step 3: Create root layout with auth guard**

```typescript
// mobile/app/_layout.tsx
import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { useAuth } from "../src/hooks/useAuth";
import { LoadingOverlay } from "../src/components/LoadingOverlay";

export default function RootLayout() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!session && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (session && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [session, loading, segments]);

  if (loading) return <LoadingOverlay message="Loading..." />;

  return <Slot />;
}
```

- [ ] **Step 4: Create auth screens**

```typescript
// mobile/app/(auth)/_layout.tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

```typescript
// mobile/app/(auth)/sign-in.tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();

  const handleSignIn = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {loading && <LoadingOverlay message="Signing in..." />}
      <Text style={styles.title}>Welcome Back</Text>
      <Text style={styles.subtitle}>Sign in to your podcast studio</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.button} onPress={handleSignIn}>
        <Text style={styles.buttonText}>Sign In</Text>
      </TouchableOpacity>
      <Link href="/(auth)/sign-up" style={styles.link}>
        Don't have an account? Sign up
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0a0a0a" },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#888", marginBottom: 32 },
  input: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    color: "#fff", fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: "#333",
  },
  button: {
    backgroundColor: "#6366f1", borderRadius: 12, padding: 16,
    alignItems: "center", marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#6366f1", textAlign: "center", marginTop: 16 },
});
```

```typescript
// mobile/app/(auth)/sign-up.tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { Link } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();

  const handleSignUp = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      await signUp(email, password);
      Alert.alert("Success", "Check your email for a confirmation link.");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {loading && <LoadingOverlay message="Creating account..." />}
      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.subtitle}>Start your podcast journey</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.button} onPress={handleSignUp}>
        <Text style={styles.buttonText}>Sign Up</Text>
      </TouchableOpacity>
      <Link href="/(auth)/sign-in" style={styles.link}>
        Already have an account? Sign in
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#0a0a0a" },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", marginBottom: 8 },
  subtitle: { fontSize: 16, color: "#888", marginBottom: 32 },
  input: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    color: "#fff", fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: "#333",
  },
  button: {
    backgroundColor: "#6366f1", borderRadius: 12, padding: 16,
    alignItems: "center", marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#6366f1", textAlign: "center", marginTop: 16 },
});
```

- [ ] **Step 5: Create tab navigator**

```typescript
// mobile/app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#6366f1",
        tabBarStyle: { backgroundColor: "#0a0a0a", borderTopColor: "#1a1a1a" },
        headerStyle: { backgroundColor: "#0a0a0a" },
        headerTintColor: "#fff",
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Library", tabBarLabel: "Library" }} />
      <Tabs.Screen name="generate" options={{ title: "Generate", tabBarLabel: "New" }} />
      <Tabs.Screen name="sources" options={{ title: "Sources", tabBarLabel: "Sources" }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarLabel: "Account" }} />
    </Tabs>
  );
}
```

- [ ] **Step 6: Create LoadingOverlay component**

```typescript
// mobile/src/components/LoadingOverlay.tsx
/**
 * LoadingOverlay — full-screen loading indicator.
 * Use for async operations (auth, generation, data fetching).
 * Props:
 *   - message: string — displayed below spinner
 */
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";

interface Props {
  message: string;
}

export function LoadingOverlay({ message }: Props) {
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color="#6366f1" />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  message: { color: "#fff", fontSize: 16, marginTop: 16 },
});
```

- [ ] **Step 7: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git add mobile/app/ mobile/src/hooks/useAuth.ts mobile/src/components/LoadingOverlay.tsx
git commit -m "feat: set up Expo Router with auth guard, sign-in/up screens, tab navigation"
```

---

## Chunk 2: Library & Generation Screens

### Task 2: Create the podcast library (Home) screen

**Files:**
- Create: `mobile/app/(tabs)/index.tsx`
- Create: `mobile/src/hooks/usePodcasts.ts`
- Create: `mobile/src/components/PodcastCard.tsx`

- [ ] **Step 1: Create usePodcasts hook with realtime**

```typescript
// mobile/src/hooks/usePodcasts.ts
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface PodcastRow {
  id: string;
  topic: string;
  status: string;
  audio_url: string | null;
  duration_seconds: number | null;
  chapter_markers: Array<{ timestamp_seconds: number; title: string }>;
  has_ads: boolean;
  created_at: string;
  error_message: string | null;
}

/** App-level type — camelCase to match TypeScript pipeline conventions */
export interface Podcast {
  id: string;
  topic: string;
  status: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  chapterMarkers: Array<{ timestampSeconds: number; title: string }>;
  hasAds: boolean;
  createdAt: string;
  errorMessage: string | null;
}

function toPodcast(row: PodcastRow): Podcast {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    audioUrl: row.audio_url,
    durationSeconds: row.duration_seconds,
    chapterMarkers: (row.chapter_markers ?? []).map((ch) => ({
      timestampSeconds: ch.timestamp_seconds,
      title: ch.title,
    })),
    hasAds: row.has_ads,
    createdAt: row.created_at,
    errorMessage: row.error_message,
  };
}

export function usePodcasts() {
  const { user } = useAuth();
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPodcasts = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("podcasts")
      .select("*")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (!error && data) setPodcasts((data as PodcastRow[]).map(toPodcast));
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    fetchPodcasts();

    // Real-time subscription for status updates
    if (!user) return;

    const channel = supabase
      .channel("podcast-status")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "podcasts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setPodcasts((prev) =>
            prev.map((p) =>
              p.id === payload.new.id ? toPodcast(payload.new as PodcastRow) : p
            )
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "podcasts",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setPodcasts((prev) => [toPodcast(payload.new as PodcastRow), ...prev]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchPodcasts]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    fetchPodcasts();
  }, [fetchPodcasts]);

  return { podcasts, loading, refreshing, refresh };
}
```

- [ ] **Step 2: Create PodcastCard component**

```typescript
// mobile/src/components/PodcastCard.tsx
/**
 * PodcastCard — displays a single podcast in the library list.
 * Shows status (generating/ready/failed), topic, and duration.
 * Tappable when status is "complete" to navigate to player.
 */
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { Podcast } from "../hooks/usePodcasts";

interface Props {
  podcast: Podcast;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "Queued", color: "#ffd43b" },
  researching: { label: "Researching...", color: "#ffd43b" },
  factChecking: { label: "Fact-checking...", color: "#ffd43b" },
  scripting: { label: "Writing script...", color: "#ffd43b" },
  generatingAudio: { label: "Generating audio...", color: "#ffd43b" },
  complete: { label: "Ready", color: "#51cf66" },
  failed: { label: "Failed", color: "#ff6b6b" },
};

export function PodcastCard({ podcast }: Props) {
  const router = useRouter();
  const status = STATUS_LABELS[podcast.status] || { label: podcast.status, color: "#888" };
  const isReady = podcast.status === "complete";
  const isFailed = podcast.status === "failed";

  const handlePress = () => {
    if (isReady) router.push(`/player/${podcast.id}`);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "";
    const mins = Math.floor(seconds / 60);
    return `${mins} min`;
  };

  return (
    <TouchableOpacity
      style={[styles.card, !isReady && styles.cardDisabled]}
      onPress={handlePress}
      disabled={!isReady}
    >
      <View style={styles.header}>
        <Text style={styles.topic} numberOfLines={2}>{podcast.topic}</Text>
        <View style={[styles.statusBadge, { backgroundColor: status.color + "20" }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>
      {isFailed && podcast.errorMessage && (
        <Text style={styles.errorText}>Credit refunded. Tap to retry.</Text>
      )}
      {isReady && (
        <Text style={styles.duration}>{formatDuration(podcast.durationSeconds)}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: "#2a2a2a",
  },
  cardDisabled: { opacity: 0.7 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  topic: { fontSize: 16, fontWeight: "600", color: "#fff", flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: "600" },
  duration: { fontSize: 14, color: "#888", marginTop: 8 },
  errorText: { fontSize: 13, color: "#ff6b6b", marginTop: 8 },
});
```

- [ ] **Step 3: Create Library screen**

```typescript
// mobile/app/(tabs)/index.tsx
import { View, FlatList, Text, StyleSheet } from "react-native";
import { usePodcasts } from "../../src/hooks/usePodcasts";
import { PodcastCard } from "../../src/components/PodcastCard";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

export default function Library() {
  const { podcasts, loading, refreshing, refresh } = usePodcasts();

  if (loading) return <LoadingOverlay message="Loading library..." />;

  return (
    <View style={styles.container}>
      <FlatList
        data={podcasts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PodcastCard podcast={item} />}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No podcasts yet</Text>
            <Text style={styles.emptySubtitle}>Tap "New" to generate your first podcast</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  list: { padding: 16 },
  empty: { alignItems: "center", marginTop: 100 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 8 },
  emptySubtitle: { fontSize: 14, color: "#888" },
});
```

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(tabs\)/index.tsx mobile/src/hooks/usePodcasts.ts mobile/src/components/PodcastCard.tsx
git commit -m "feat: add podcast library screen with realtime status updates"
```

### Task 3: Create the Generate screen with clarifying Q&A

**Files:**
- Create: `mobile/app/(tabs)/generate.tsx`
- Create: `mobile/src/components/ClarifyingChat.tsx`
- Create: `mobile/src/services/podcast.ts`
- Create: `mobile/src/hooks/useSubscription.ts`
- Create: `mobile/src/components/CreditBalance.tsx`

- [ ] **Step 1: Create podcast service**

```typescript
// mobile/src/services/podcast.ts
import { supabase } from "../lib/supabase";

export async function generateQuestions(topic: string): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke("generate-questions", {
    body: { topic },
  });
  if (error) throw new Error(error.message || "Failed to generate questions");
  return data.questions;
}

export async function submitPodcast(
  topic: string,
  clarifyingAnswers: Array<{ q: string; a: string }>,
  trustedSourceId?: string
): Promise<{ podcastId: string }> {
  const { data, error } = await supabase.functions.invoke("submit-podcast", {
    body: { topic, clarifyingAnswers, trustedSourceId },
  });
  if (error) throw new Error(error.message || "Failed to submit podcast");
  return data;
}
```

- [ ] **Step 2: Create subscription hook**

```typescript
// mobile/src/hooks/useSubscription.ts
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

/** Raw shape from Supabase (snake_case DB columns) */
interface SubscriptionRow {
  tier: "free" | "plus" | "pro";
  credits_remaining: number;
  credits_per_month: number;
  status: string;
}

/** App-level type — camelCase */
export interface Subscription {
  tier: "free" | "plus" | "pro";
  creditsRemaining: number;
  creditsPerMonth: number;
  status: string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    tier: row.tier,
    creditsRemaining: row.credits_remaining,
    creditsPerMonth: row.credits_per_month,
    status: row.status,
  };
}

export function useSubscription() {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("subscriptions")
      .select("tier, credits_remaining, credits_per_month, status")
      .eq("user_id", user.id)
      .single();
    if (data) setSubscription(toSubscription(data as SubscriptionRow));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const refresh = useCallback(() => { fetch(); }, [fetch]);

  return { subscription, loading, refresh };
}
```

- [ ] **Step 3: Create CreditBalance component**

```typescript
// mobile/src/components/CreditBalance.tsx
/**
 * CreditBalance — shows remaining credits and tier.
 * Displays a warning when credits are low.
 */
import { View, Text, StyleSheet } from "react-native";
import type { Subscription } from "../hooks/useSubscription";

interface Props {
  subscription: Subscription;
}

export function CreditBalance({ subscription }: Props) {
  const isLow = subscription.creditsRemaining <= 1;
  return (
    <View style={[styles.container, isLow && styles.low]}>
      <Text style={styles.credits}>{subscription.creditsRemaining}</Text>
      <Text style={styles.label}>
        credits remaining ({subscription.tier})
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
  },
  low: { borderColor: "#ff6b6b", borderWidth: 1 },
  credits: { fontSize: 24, fontWeight: "700", color: "#6366f1" },
  label: { fontSize: 14, color: "#888" },
});
```

- [ ] **Step 4: Create ClarifyingChat component**

```typescript
// mobile/src/components/ClarifyingChat.tsx
/**
 * ClarifyingChat — interactive Q&A for refining podcast topic.
 * Shows questions one at a time, collects answers.
 * Props:
 *   - questions: string[] — generated by Edge Function
 *   - onComplete: (answers) => void — called when all questions answered
 *   - onCancel: () => void
 */
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";

interface Props {
  questions: string[];
  onComplete: (answers: Array<{ q: string; a: string }>) => void;
  onCancel: () => void;
}

export function ClarifyingChat({ questions, onComplete, onCancel }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [answers, setAnswers] = useState<Array<{ q: string; a: string }>>([]);

  const handleNext = () => {
    if (!answer.trim()) return;
    const newAnswers = [...answers, { q: questions[currentIndex], a: answer.trim() }];

    if (currentIndex < questions.length - 1) {
      setAnswers(newAnswers);
      setCurrentIndex(currentIndex + 1);
      setAnswer("");
    } else {
      onComplete(newAnswers);
    }
  };

  const isLast = currentIndex === questions.length - 1;

  return (
    <View style={styles.container}>
      <Text style={styles.progress}>
        Question {currentIndex + 1} of {questions.length}
      </Text>
      <Text style={styles.question}>{questions[currentIndex]}</Text>
      <TextInput
        style={styles.input}
        value={answer}
        onChangeText={setAnswer}
        placeholder="Your answer..."
        placeholderTextColor="#666"
        multiline
        autoFocus
      />
      <View style={styles.actions}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text style={styles.nextText}>{isLast ? "Generate Podcast" : "Next"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  progress: { fontSize: 14, color: "#888", marginBottom: 16 },
  question: { fontSize: 20, fontWeight: "600", color: "#fff", marginBottom: 24, lineHeight: 28 },
  input: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    color: "#fff", fontSize: 16, minHeight: 80, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#333",
  },
  actions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 24 },
  cancelText: { color: "#888", fontSize: 16 },
  nextButton: { backgroundColor: "#6366f1", borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  nextText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 5: Create Generate screen**

```typescript
// mobile/app/(tabs)/generate.tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditBalance } from "../../src/components/CreditBalance";
import { ClarifyingChat } from "../../src/components/ClarifyingChat";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import { generateQuestions, submitPodcast } from "../../src/services/podcast";

type Phase = "input" | "loading-questions" | "clarifying" | "submitting";

export default function Generate() {
  const [topic, setTopic] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [questions, setQuestions] = useState<string[]>([]);
  const { subscription, refresh: refreshSub } = useSubscription();
  const router = useRouter();

  const handleStartGeneration = async () => {
    if (!topic.trim()) return;
    if (!subscription || subscription.creditsRemaining < 1) {
      Alert.alert("No Credits", "Purchase more credits to generate a podcast.");
      return;
    }

    setPhase("loading-questions");
    try {
      const qs = await generateQuestions(topic.trim());
      setQuestions(qs);
      setPhase("clarifying");
    } catch (error: any) {
      Alert.alert("Error", error.message);
      setPhase("input");
    }
  };

  const handleClarifyingComplete = async (answers: Array<{ q: string; a: string }>) => {
    setPhase("submitting");
    try {
      await submitPodcast(topic.trim(), answers);
      refreshSub();
      Alert.alert("Podcast Generating", "We'll notify you when it's ready!", [
        { text: "OK", onPress: () => { setPhase("input"); setTopic(""); router.push("/(tabs)"); } },
      ]);
    } catch (error: any) {
      Alert.alert("Error", error.message);
      setPhase("input");
    }
  };

  if (phase === "loading-questions") return <LoadingOverlay message="Preparing questions..." />;
  if (phase === "submitting") return <LoadingOverlay message="Starting generation..." />;

  if (phase === "clarifying") {
    return (
      <View style={styles.container}>
        <ClarifyingChat
          questions={questions}
          onComplete={handleClarifyingComplete}
          onCancel={() => setPhase("input")}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {subscription && <CreditBalance subscription={subscription} />}
        <Text style={styles.title}>What do you want to learn about?</Text>
        <TextInput
          style={styles.topicInput}
          value={topic}
          onChangeText={setTopic}
          placeholder="e.g., the impact of quantum computing on cryptography"
          placeholderTextColor="#666"
          multiline
        />
        <TouchableOpacity
          style={[styles.generateButton, !topic.trim() && styles.disabled]}
          onPress={handleStartGeneration}
          disabled={!topic.trim()}
        >
          <Text style={styles.generateText}>Generate Podcast (1 credit)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { flex: 1, padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: "700", color: "#fff", marginTop: 16 },
  topicInput: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    color: "#fff", fontSize: 16, minHeight: 100, textAlignVertical: "top",
    borderWidth: 1, borderColor: "#333",
  },
  generateButton: {
    backgroundColor: "#6366f1", borderRadius: 12, padding: 16,
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
  generateText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 6: Commit**

```bash
git add mobile/app/\(tabs\)/generate.tsx mobile/src/components/ClarifyingChat.tsx mobile/src/components/CreditBalance.tsx mobile/src/services/podcast.ts mobile/src/hooks/useSubscription.ts
git commit -m "feat: add Generate screen with clarifying Q&A flow and credit validation"
```

---

## Chunk 3: Audio Player

### Task 4: Set up react-native-track-player and create the player screen

**Files:**
- Create: `mobile/src/services/player.ts`
- Create: `mobile/src/hooks/usePlayer.ts`
- Create: `mobile/src/components/AudioPlayer.tsx`
- Create: `mobile/src/components/ChapterMarkers.tsx`
- Create: `mobile/app/player/[id].tsx`

- [ ] **Step 1: Create player service**

```typescript
// mobile/src/services/player.ts
import TrackPlayer, { Capability, Event } from "react-native-track-player";

let isSetup = false;

export async function setupPlayer() {
  if (isSetup) return;
  await TrackPlayer.setupPlayer();
  await TrackPlayer.updateOptions({
    capabilities: [
      Capability.Play,
      Capability.Pause,
      Capability.SeekTo,
      Capability.SkipToNext,
      Capability.SkipToPrevious,
    ],
    compactCapabilities: [Capability.Play, Capability.Pause, Capability.SeekTo],
  });
  isSetup = true;
}

export async function loadTrack(id: string, url: string, title: string) {
  await TrackPlayer.reset();
  await TrackPlayer.add({
    id,
    url,
    title,
    artist: "AI Podcast",
  });
}
```

- [ ] **Step 2: Create usePlayer hook**

```typescript
// mobile/src/hooks/usePlayer.ts
import { useState, useEffect, useCallback } from "react";
import TrackPlayer, { useProgress, State, usePlaybackState } from "react-native-track-player";
import { setupPlayer, loadTrack } from "../services/player";

export function usePlayer(podcastId: string, audioUrl: string, title: string) {
  const [ready, setReady] = useState(false);
  const progress = useProgress();
  const playbackState = usePlaybackState();

  useEffect(() => {
    (async () => {
      await setupPlayer();
      await loadTrack(podcastId, audioUrl, title);
      setReady(true);
    })();

    return () => { TrackPlayer.reset(); };
  }, [podcastId, audioUrl, title]);

  const play = useCallback(async () => { await TrackPlayer.play(); }, []);
  const pause = useCallback(async () => { await TrackPlayer.pause(); }, []);
  const seekTo = useCallback(async (seconds: number) => { await TrackPlayer.seekTo(seconds); }, []);

  const isPlaying = playbackState.state === State.Playing;

  return { ready, isPlaying, progress, play, pause, seekTo };
}
```

- [ ] **Step 3: Create AudioPlayer component**

```typescript
// mobile/src/components/AudioPlayer.tsx
/**
 * AudioPlayer — play/pause button, seek bar, time display.
 * Props:
 *   - isPlaying: boolean
 *   - progress: { position, duration }
 *   - onPlay, onPause, onSeek
 */
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Slider from "@react-native-community/slider";

interface Props {
  isPlaying: boolean;
  position: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AudioPlayer({ isPlaying, position, duration, onPlay, onPause, onSeek }: Props) {
  return (
    <View style={styles.container}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={duration || 1}
        value={position}
        onSlidingComplete={onSeek}
        minimumTrackTintColor="#6366f1"
        maximumTrackTintColor="#333"
        thumbTintColor="#6366f1"
      />
      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatTime(position)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
      <TouchableOpacity style={styles.playButton} onPress={isPlaying ? onPause : onPlay}>
        <Text style={styles.playIcon}>{isPlaying ? "||" : ">"}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", padding: 24 },
  slider: { width: "100%", height: 40 },
  timeRow: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  time: { color: "#888", fontSize: 13 },
  playButton: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#6366f1",
    justifyContent: "center", alignItems: "center", marginTop: 16,
  },
  playIcon: { color: "#fff", fontSize: 28, fontWeight: "700" },
});
```

- [ ] **Step 4: Create ChapterMarkers component**

```typescript
// mobile/src/components/ChapterMarkers.tsx
/**
 * ChapterMarkers — tappable list of chapters with timestamps.
 * Highlights the currently playing chapter.
 */
import { View, Text, TouchableOpacity, StyleSheet, FlatList } from "react-native";

interface Chapter {
  timestampSeconds: number;
  title: string;
}

interface Props {
  chapters: Chapter[];
  currentPosition: number;
  onChapterPress: (seconds: number) => void;
}

export function ChapterMarkers({ chapters, currentPosition, onChapterPress }: Props) {
  const currentChapterIndex = chapters.reduce((acc, ch, i) => {
    if (currentPosition >= ch.timestampSeconds) return i;
    return acc;
  }, 0);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <FlatList
      data={chapters}
      keyExtractor={(_, i) => i.toString()}
      renderItem={({ item, index }) => (
        <TouchableOpacity
          style={[styles.chapter, index === currentChapterIndex && styles.active]}
          onPress={() => onChapterPress(item.timestampSeconds)}
        >
          <Text style={styles.timestamp}>{formatTime(item.timestampSeconds)}</Text>
          <Text style={[styles.title, index === currentChapterIndex && styles.activeText]}>
            {item.title}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  chapter: { flexDirection: "row", padding: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: "#1a1a1a" },
  active: { backgroundColor: "#6366f120" },
  timestamp: { color: "#888", fontSize: 14, width: 50 },
  title: { color: "#fff", fontSize: 15, flex: 1 },
  activeText: { color: "#6366f1", fontWeight: "600" },
});
```

- [ ] **Step 5: Create Player screen**

```typescript
// mobile/app/player/[id].tsx
import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../src/lib/supabase";
import { usePlayer } from "../../src/hooks/usePlayer";
import { AudioPlayer } from "../../src/components/AudioPlayer";
import { ChapterMarkers } from "../../src/components/ChapterMarkers";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";
import type { Podcast } from "../../src/hooks/usePodcasts";

export default function PlayerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("podcasts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setPodcast(data as Podcast);
      setLoading(false);
    })();
  }, [id]);

  const player = usePlayer(
    podcast?.id || "",
    podcast?.audioUrl || "",
    podcast?.topic || ""
  );

  if (loading || !podcast) return <LoadingOverlay message="Loading podcast..." />;
  if (!player.ready) return <LoadingOverlay message="Preparing audio..." />;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.topic}>{podcast.topic}</Text>

        <AudioPlayer
          isPlaying={player.isPlaying}
          position={player.progress.position}
          duration={player.progress.duration}
          onPlay={player.play}
          onPause={player.pause}
          onSeek={player.seekTo}
        />

        {podcast.chapterMarkers.length > 0 && (
          <View style={styles.chapters}>
            <Text style={styles.chaptersTitle}>Chapters</Text>
            <ChapterMarkers
              chapters={podcast.chapterMarkers}
              currentPosition={player.progress.position}
              onChapterPress={player.seekTo}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  content: { padding: 24 },
  topic: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 24, lineHeight: 30 },
  chapters: { marginTop: 24 },
  chaptersTitle: { fontSize: 18, fontWeight: "600", color: "#fff", marginBottom: 12 },
});
```

- [ ] **Step 6: Install slider dependency**

```bash
cd "/Users/isuru/personal/AI Podcast App/mobile"
npx expo install @react-native-community/slider
```

- [ ] **Step 7: Commit**

```bash
cd "/Users/isuru/personal/AI Podcast App"
git add mobile/src/services/player.ts mobile/src/hooks/usePlayer.ts mobile/src/components/AudioPlayer.tsx mobile/src/components/ChapterMarkers.tsx mobile/app/player/
git commit -m "feat: add audio player screen with chapter markers and track player"
```

---

## Chunk 4: Account, Sources & Push Notifications

### Task 5: Create Account screen

**Files:**
- Create: `mobile/app/(tabs)/account.tsx`

- [ ] **Step 1: Create Account screen with subscription info and credit purchase**

```typescript
// mobile/app/(tabs)/account.tsx
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { CreditBalance } from "../../src/components/CreditBalance";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

const CREDIT_PRICES: Record<string, number> = { free: 5, plus: 4, pro: 3 };

export default function Account() {
  const { user, signOut } = useAuth();
  const { subscription, loading } = useSubscription();

  if (loading) return <LoadingOverlay message="Loading account..." />;

  const creditPrice = CREDIT_PRICES[subscription?.tier || "free"];

  const handleBuyCredit = () => {
    // TODO: Implement via RevenueCat (Plan 4)
    Alert.alert("Coming Soon", "Credit purchases will be available via in-app purchase.");
  };

  const handleUpgrade = () => {
    // TODO: Implement via RevenueCat (Plan 4)
    Alert.alert("Coming Soon", "Subscription upgrades will be available soon.");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.email}>{user?.email}</Text>

      {subscription && <CreditBalance subscription={subscription} />}

      <TouchableOpacity style={styles.buyButton} onPress={handleBuyCredit}>
        <Text style={styles.buyText}>Buy Extra Credit (${creditPrice})</Text>
      </TouchableOpacity>

      {subscription?.tier === "free" && (
        <TouchableOpacity style={styles.upgradeButton} onPress={handleUpgrade}>
          <Text style={styles.upgradeText}>Upgrade to Plus — $14.99/mo</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 24, gap: 16 },
  email: { fontSize: 16, color: "#888", marginBottom: 8 },
  buyButton: {
    backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16,
    alignItems: "center", borderWidth: 1, borderColor: "#6366f1",
  },
  buyText: { color: "#6366f1", fontSize: 16, fontWeight: "600" },
  upgradeButton: {
    backgroundColor: "#6366f1", borderRadius: 12, padding: 16, alignItems: "center",
  },
  upgradeText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  signOutButton: { marginTop: "auto", padding: 16, alignItems: "center" },
  signOutText: { color: "#ff6b6b", fontSize: 16 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/\(tabs\)/account.tsx
git commit -m "feat: add Account screen with credit balance and upgrade placeholder"
```

### Task 6: Create Trusted Sources screen

**Files:**
- Create: `mobile/app/(tabs)/sources.tsx`

- [ ] **Step 1: Create Sources screen (Pro-only)**

```typescript
// mobile/app/(tabs)/sources.tsx
import { useState, useEffect, useCallback } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from "react-native";
import { supabase } from "../../src/lib/supabase";
import { useAuth } from "../../src/hooks/useAuth";
import { useSubscription } from "../../src/hooks/useSubscription";
import { LoadingOverlay } from "../../src/components/LoadingOverlay";

interface TrustedSource {
  id: string;
  name: string;
  urls: Array<{ url: string; label: string }>;
}

export default function Sources() {
  const { user } = useAuth();
  const { subscription } = useSubscription();
  const [sources, setSources] = useState<TrustedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const fetchSources = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("trusted_sources")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setSources(data as TrustedSource[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchSources(); }, [fetchSources]);

  if (subscription?.tier !== "pro") {
    return (
      <View style={styles.locked}>
        <Text style={styles.lockedTitle}>Pro Feature</Text>
        <Text style={styles.lockedSubtitle}>
          Upgrade to Pro to curate trusted sources for your podcasts.
        </Text>
      </View>
    );
  }

  const handleAddSource = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    const { error } = await supabase.from("trusted_sources").insert({
      user_id: user!.id,
      name: newName.trim(),
      urls: [{ url: newUrl.trim(), label: newName.trim() }],
    });
    if (error) { Alert.alert("Error", error.message); return; }
    setNewName("");
    setNewUrl("");
    fetchSources();
  };

  if (loading) return <LoadingOverlay message="Loading sources..." />;

  return (
    <View style={styles.container}>
      <View style={styles.addForm}>
        <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Collection name" placeholderTextColor="#666" />
        <TextInput style={styles.input} value={newUrl} onChangeText={setNewUrl} placeholder="URL" placeholderTextColor="#666" autoCapitalize="none" />
        <TouchableOpacity style={styles.addButton} onPress={handleAddSource}>
          <Text style={styles.addText}>Add Source</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={sources}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.sourceCard}>
            <Text style={styles.sourceName}>{item.name}</Text>
            <Text style={styles.sourceCount}>{item.urls.length} URLs</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No trusted sources yet</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", padding: 16 },
  locked: { flex: 1, backgroundColor: "#0a0a0a", justifyContent: "center", alignItems: "center", padding: 24 },
  lockedTitle: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 8 },
  lockedSubtitle: { fontSize: 16, color: "#888", textAlign: "center" },
  addForm: { gap: 8, marginBottom: 16 },
  input: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 12, color: "#fff", borderWidth: 1, borderColor: "#333" },
  addButton: { backgroundColor: "#6366f1", borderRadius: 12, padding: 12, alignItems: "center" },
  addText: { color: "#fff", fontWeight: "600" },
  sourceCard: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, marginBottom: 8 },
  sourceName: { color: "#fff", fontSize: 16, fontWeight: "600" },
  sourceCount: { color: "#888", fontSize: 13, marginTop: 4 },
  empty: { color: "#888", textAlign: "center", marginTop: 40 },
});
```

- [ ] **Step 2: Commit**

```bash
git add mobile/app/\(tabs\)/sources.tsx
git commit -m "feat: add Trusted Sources screen (Pro-only)"
```

### Task 7: Set up push notifications

**Files:**
- Create: `mobile/src/hooks/usePushNotifications.ts`

- [ ] **Step 1: Create push notification hook**

```typescript
// mobile/src/hooks/usePushNotifications.ts
import { useState, useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function usePushNotifications() {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const notificationListener = useRef<Notifications.EventSubscription>();

  useEffect(() => {
    if (!user || !Device.isDevice) return;

    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== "granted") return;

      const pushToken = (await Notifications.getExpoPushTokenAsync()).data;
      setToken(pushToken);

      // Save token to profile
      await supabase
        .from("profiles")
        .update({ expo_push_token: pushToken })
        .eq("id", user.id);
    })();

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Notification received while app is foregrounded — UI updates via Realtime
      }
    );

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
    };
  }, [user]);

  return { token };
}
```

- [ ] **Step 2: Wire up in root layout**

Add to `mobile/app/_layout.tsx` inside the component:

```typescript
import { usePushNotifications } from "../src/hooks/usePushNotifications";

// Inside RootLayout component:
usePushNotifications();
```

- [ ] **Step 3: Commit**

```bash
git add mobile/src/hooks/usePushNotifications.ts mobile/app/_layout.tsx
git commit -m "feat: add push notification registration and handler"
```

---

## Summary

After completing this plan, you will have:
- Auth flow (sign-in, sign-up, session management)
- Tab navigation (Library, Generate, Sources, Account)
- Podcast library with real-time status updates via Supabase Realtime
- Generate screen with clarifying Q&A chat flow
- Full audio player with seek bar, chapter markers, background playback
- Trusted Sources management (Pro-only)
- Account screen with credit balance
- Push notification registration and handling

**Next:** Plan 4 (Integrations) adds RevenueCat payments and ElevenLabs interactive Q&A.
