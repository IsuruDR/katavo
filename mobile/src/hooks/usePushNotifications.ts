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
