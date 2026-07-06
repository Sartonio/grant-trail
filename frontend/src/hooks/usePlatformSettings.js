import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Fetch platform-wide defaults (support contact fallbacks). Reads the curated
// `platform_settings_public` view — the base table's SELECT is restricted to
// super_admins so the alert_webhook_url secret is never world-readable.
export function usePlatformSettings() {
  const [platformSettings, setPlatformSettings] = useState(null);

  useEffect(() => {
    async function fetchPlatformSettings() {
      const { data } = await supabase.from('platform_settings_public').select('*').single();
      if (data) setPlatformSettings(data);
    }
    fetchPlatformSettings();
  }, []);

  return platformSettings;
}
