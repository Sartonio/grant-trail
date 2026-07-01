import { adminSupabase } from './stripe.ts';

export type LogSeverity = 'info' | 'warning' | 'error' | 'critical';

// Defensive write to system_logs. supabase-js query builders are thenables, not
// Promises — and a logging failure must NEVER re-throw out of a handler (in the
// Stripe webhook that would 4xx/5xx an already-done operation and trigger a
// retry). Every write is wrapped; failures are swallowed after a console note.
export async function logSystemEvent(
  eventName: string,
  severity: LogSeverity,
  message: string,
  metadata: Record<string, unknown> = {},
  stack?: string,
): Promise<void> {
  try {
    await adminSupabase.from('system_logs').insert({
      event_name: eventName,
      error_message: message,
      error_stack: stack,
      severity,
      metadata,
    });
  } catch (logError) {
    console.error('Failed to write system log to database:', logError);
  }
}
