import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Notifications state + realtime subscription. Fetches the latest notifications
// for the current session's user and subscribes to INSERTs in realtime.
export function useNotifications(session) {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    if (!session?.userRecord) {
      setNotifications([]);
      return;
    }

    const userId = session.userRecord.id;

    async function fetchNotifications() {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      setNotifications(data || []);
    }

    fetchNotifications();

    // Subscribe to new notifications in realtime
    const channel = supabase
      .channel('user-notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications(prev => [payload.new, ...prev]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  function handleMarkRead(notificationId) {
    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
    );
  }

  function handleMarkAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  }

  function handleClearAll() {
    setNotifications([]);
  }

  return { notifications, handleMarkRead, handleMarkAllRead, handleClearAll };
}
