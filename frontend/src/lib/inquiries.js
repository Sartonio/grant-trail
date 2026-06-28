import { supabase } from '../supabaseClient';

// Best-effort notification: ask the `notify-inquiry` edge function to email the
// charity that a new sponsorship inquiry has arrived. The inquiry itself is
// already saved by the time this runs, so callers should treat a failure here as
// non-fatal (the seeker's submission still succeeded) — log it and move on.
export async function notifyInquirySubmitted(inquiryId) {
  const { error } = await supabase.functions.invoke('notify-inquiry', {
    body: { inquiryId },
  });
  if (error) throw error;
}
