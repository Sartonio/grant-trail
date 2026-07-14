// Data-access for the admin grant-review aux tables — grantee profile,
// status history, and comments (modularity.md, Phase 3).
import { createEntityData } from './_factory';

const users = createEntityData('users');
const statusHistory = createEntityData('grant_status_history');
const comments = createEntityData('grant_comments');

// Narrow projection of the grantee's profile, just what the review page shows.
/** @param {string} userId */
export const getGrantee = (userId) =>
  users.getBy('id', userId, { select: 'firstname, lastname, organization_name, email' });

/** @param {number} grantId */
export const listGrantStatusHistory = (grantId) =>
  statusHistory.listBy('grant_id', grantId, { order: ['created_at', { ascending: true }] });

/** @param {number} grantId */
export const listGrantComments = (grantId) =>
  comments.listBy('grant_id', grantId, { order: ['created_at', { ascending: true }] });

/**
 * @param {number} grantId
 * @param {string} comment
 * @param {string} userId
 */
export const addGrantComment = (grantId, comment, userId) =>
  comments.insert({ grant_id: grantId, comment, user_id: userId });
