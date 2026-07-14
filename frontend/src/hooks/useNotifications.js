import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Notifications state + realtime subscription. Fetches the latest notifications
// for the current session's user and subscribes to INSERTs in realtime.
/** @typedef {import('../lib/types').Session} Session */
/** @typedef {import('../lib/database.types').Database['public']['Tables']['notifications']['Row']} NotificationRow */

/** @param {Session|null} [session] */
export function useNotifications(session) {
  const [notifications, setNotifications] = useState(
    /** @type {NotificationRow[]} */ ([]),
  );

  useEffect(() => {
    if (!session?.userRecord) {
      setNotifications([]);
      return;
    }

    const userId = session.userRecord.id;

    async function fetchNotifications() {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      setNotifications(data || []);
    }

    fetchNotifications();

    // Subscribe to new notifications in realtime
    const channel = supabase
      .channel("user-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setNotifications((prev) => [
            /** @type {NotificationRow} */ (payload.new),
            ...prev,
          ]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  /** @param {number} notificationId */
  function handleMarkRead(notificationId) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
    );
  }

  function handleMarkAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  function handleClearAll() {
    setNotifications([]);
  }

  return { notifications, handleMarkRead, handleMarkAllRead, handleClearAll };
}
