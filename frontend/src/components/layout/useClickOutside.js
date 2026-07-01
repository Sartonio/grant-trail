import { useEffect } from 'react';

/**
 * Close a popover/dropdown when a mousedown lands outside the referenced element.
 * Mirrors the exact behavior previously inlined in Header and NotificationBell:
 * a `mousedown` listener on `document`, closing when the target is outside `ref`.
 *
 * @param {import('react').RefObject<HTMLElement>} ref - wrapper treated as "inside".
 * @param {() => void} onOutside - called when a mousedown occurs outside `ref`.
 */
export function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onOutside();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [ref, onOutside]);
}
