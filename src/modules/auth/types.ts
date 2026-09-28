export const ROLES = ["viewer", "operator", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Higher numbers include every capability of the lower ones. */
export const ROLE_RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export interface Actor {
  /** API key id, or "anonymous" when auth is disabled for local browsing. */
  id: string;
  name: string;
  role: Role;
}

export const ANONYMOUS_VIEWER: Actor = Object.freeze({
  id: "anonymous",
  name: "anonymous",
  role: "viewer",
});
