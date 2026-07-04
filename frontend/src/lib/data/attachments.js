// Data-access for the grant_attachments table.
import { supabase } from '../../supabaseClient';
/** @typedef {import('../types').GrantAttachmentInsert} GrantAttachmentInsert */

/** @param {number} grantId */
export const listGrantAttachments = (grantId) =>
  supabase.from('grant_attachments').select('*').eq('grant_id', grantId).order('created_at', { ascending: false });

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<GrantAttachmentInsert, 'tenant_id'>} attachment */
export const insertGrantAttachment = (attachment) =>
  supabase.from('grant_attachments').insert(attachment);

/** @param {number} id */
export const deleteGrantAttachment = (id) =>
  supabase.from('grant_attachments').delete().eq('id', id);
