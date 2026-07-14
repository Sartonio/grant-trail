// Data-access for the grant_attachments table.
import { createEntityData } from './_factory';
/** @typedef {import('../types').GrantAttachmentInsert} GrantAttachmentInsert */

const attachments = createEntityData('grant_attachments');

/** @param {number} grantId */
export const listGrantAttachments = (grantId) =>
  attachments.listBy('grant_id', grantId, { order: ['created_at', { ascending: false }] });

// tenant_id is filled server-side (trigger/default) — callers don't set it.
/** @param {Omit<GrantAttachmentInsert, 'tenant_id'>} attachment */
export const insertGrantAttachment = (attachment) => attachments.insert(attachment);

/** @param {number} id */
export const deleteGrantAttachment = (id) => attachments.deleteBy('id', id);
