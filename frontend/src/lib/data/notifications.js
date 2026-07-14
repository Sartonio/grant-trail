// Data-access for the notifications table (notification bell dropdown).
import { createEntityData } from './_factory';

const notifications = createEntityData('notifications');

/** @param {number} id */
export const markNotificationRead = (id) => notifications.updateBy('id', id, { is_read: true });

/** @param {number[]} ids */
export const markNotificationsRead = (ids) =>
  notifications.updateIn('id', ids, { is_read: true });

/** @param {number[]} ids */
export const deleteNotifications = (ids) => notifications.deleteIn('id', ids);
