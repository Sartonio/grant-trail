import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiBell } from 'react-icons/fi';
import { supabase } from '../../supabaseClient';
import './NotificationBell.css';

function NotificationBell({ notifications, onMarkRead, onMarkAllRead, onClearAll }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  const unreadCount = notifications.filter(n => !n.is_read).length;

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification.id);
      onMarkRead(notification.id);
    }
    setOpen(false);
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', unreadIds);
    onMarkAllRead();
  };

  const handleClearAll = async () => {
    if (notifications.length === 0) return;

    const allIds = notifications.map(n => n.id);
    await supabase
      .from('notifications')
      .delete()
      .in('id', allIds);
    onClearAll();
  };

  function timeAgo(dateStr) {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  }

  return (
    <li className="notification-bell-wrapper" ref={panelRef}>
      <button
        className="notification-bell-trigger"
        onClick={() => setOpen(o => !o)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <FiBell size={18} />
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div className="notification-panel">
          <div className="notification-panel-header">
            <span className="notification-panel-title">Notifications</span>
            {unreadCount > 0 && (
              <button className="notification-mark-all" onClick={handleMarkAllRead}>
                Mark all as read
              </button>
            )}
          </div>

          <div className="notification-panel-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">No notifications yet.</div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  className={`notification-item${n.is_read ? '' : ' unread'}`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div className="notification-item-dot-col">
                    {!n.is_read && <span className="notification-dot" />}
                  </div>
                  <div className="notification-item-content">
                    <span className="notification-item-title">{n.title}</span>
                    <span className="notification-item-message">{n.message}</span>
                    <span className="notification-item-time">{timeAgo(n.created_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="notification-panel-footer">
              <button className="notification-clear-all" onClick={handleClearAll}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default NotificationBell;
