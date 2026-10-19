/** Serialisation helpers shared by owner-facing and public share endpoints. */

export function shareIsExpired(share) {
  return Boolean(share.expires_at) && Date.parse(share.expires_at) <= Date.now();
}

function shareNode(share) {
  return {
    name: share.node_name,
    type: share.node_type,
    size: share.node_type === 'folder' ? (share.node_effective_size ?? 0) : share.node_size,
    mime: share.node_type === 'folder' ? null : share.node_mime,
  };
}

/** Owner view: includes internal ids + a ready-to-copy URL. */
export function serializeOwnerShare(share, config) {
  const path = `/s/${share.token}`;
  return {
    id: share.id,
    token: share.token,
    url: config.publicBaseUrl ? `${config.publicBaseUrl}${path}` : path,
    node: {
      id: share.node_id,
      ...shareNode(share),
    },
    hasPassword: Boolean(share.password_hash),
    expiresAt: share.expires_at ?? null,
    createdAt: share.created_at,
    downloadCount: share.download_count,
  };
}

/** Public view: no internal ids, includes owner display name. */
export function serializePublicShare(share) {
  return {
    token: share.token,
    node: shareNode(share),
    hasPassword: Boolean(share.password_hash),
    expired: false,
    expiresAt: share.expires_at ?? null,
    ownerName: share.owner_display_name || share.owner_username,
    createdAt: share.created_at,
    downloadCount: share.download_count,
  };
}
