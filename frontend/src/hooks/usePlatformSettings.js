import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

// Fetch platform-wide defaults (support contact fallbacks).
export function usePlatformSettings() {
  const [platformSettings, setPlatformSettings] = useState(null);

  useEffect(() => {
    async function fetchPlatformSettings() {
      const { data } = await supabase.from('platform_settings').select('*').single();
      if (data) setPlatformSettings(data);
    }
    fetchPlatformSettings();
  }, []);

  return platformSettings;
}
