const MAX_NODES = 100;

/** Escape text for use inside Mermaid node labels */
export function escapeLabel(text: string): string {
  return text
    .replace(/"/g, "#quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "#124;");
}

/** Sanitize an ID for use as a Mermaid node identifier */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export interface TruncationInfo {
  truncated: boolean;
  shownNodes: number;
  totalNodes: number;
}

/**
 * If there are more nodes than MAX_NODES, return a truncated set
 * and info about the truncation.
 */
export function truncateIfNeeded<T>(
  items: T[],
  limit = MAX_NODES
): { items: T[]; info: TruncationInfo } {
  if (items.length <= limit) {
    return {
      items,
      info: {
        truncated: false,
        shownNodes: items.length,
        totalNodes: items.length,
      },
    };
  }
  return {
    items: items.slice(0, limit),
    info: {
      truncated: true,
      shownNodes: limit,
      totalNodes: items.length,
    },
  };
}
