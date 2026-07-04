// Data-access for the notifications table (notification bell dropdown).
import { supabase } from '../../supabaseClient';

/** @param {number} id */
export const markNotificationRead = (id) =>
  supabase.from('notifications').update({ is_read: true }).eq('id', id);

/** @param {number[]} ids */
export const markNotificationsRead = (ids) =>
  supabase.from('notifications').update({ is_read: true }).in('id', ids);

/** @param {number[]} ids */
export const deleteNotifications = (ids) =>
  supabase.from('notifications').delete().in('id', ids);
