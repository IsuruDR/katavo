// mobile/src/hooks/usePushNotifications.ts
import { useState, useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { useAuth } from "./useAuth";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Resolves a notification data payload into a route path the router
 * can push. Two server-side shapes today:
 *   - notify-complete: { podcast_id, status }
 *   - expansion-prompt cron: { deepLink, podcastId }
 *
 * Returns null if the data doesn't carry a podcast reference. Never
 * includes a play=true hint, so landing on the player loads-and-pauses
 * per the existing PlayingPodcastContext.load semantics. User taps play
 * manually after the screen mounts.
 */
function routeFromNotificationData(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) return null;
  if (typeof data.deepLink === "string" && data.deepLink.length > 0) {
    return data.deepLink;
  }
  const id = data.podcast_id ?? data.podcastId;
  if (typeof id === "string" && id.length > 0) {
    return `/player/${id}`;
  }
  return null;
}

export function usePushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const notificationListener = useRef<{ remove: () => void }>(undefined!);
  const responseListener = useRef<{ remove: () => void }>(undefined!);
  // Guard so a cold-start handler doesn't re-fire on every auth re-resolve.
  const coldStartHandledRef = useRef(false);

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

      await supabase
        .from("profiles")
        .update({ expo_push_token: pushToken })
        .eq("id", user.id);
    })();

    // Foreground/background tap handler. Fires when the user taps a
    // delivered notification while the app is alive in memory.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const path = routeFromNotificationData(
          response.notification.request.content.data as Record<string, unknown>,
        );
        if (path) router.push(path as never);
      },
    );

    // Cold-start: app was killed when the notification was tapped, the OS
    // launched the app, the response is sitting on the last-response
    // queue. Drain it once.
    if (!coldStartHandledRef.current) {
      coldStartHandledRef.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (!response) return;
        const path = routeFromNotificationData(
          response.notification.request.content.data as Record<string, unknown>,
        );
        if (path) router.push(path as never);
      });
    }

    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Notification received while app is foregrounded; UI updates via Realtime.
      },
    );

    return () => {
      if (notificationListener.current) notificationListener.current.remove();
      if (responseListener.current) responseListener.current.remove();
    };
  }, [user, router]);

  return { token };
}
