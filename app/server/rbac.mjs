import { all, get, json } from './db.mjs';
import { forbidden } from './http.mjs';

/** Layer 1 — module access rights (which app areas a user can open). */
export const MODULES = [
  'pulse', 'leads', 'deals', 'contacts', 'activities', 'mail',
  'products', 'projects', 'insights', 'automations', 'campaigns', 'documents', 'admin',
];

/** Layer 2 — permission sets (which actions a user can perform). */
export const PERMISSIONS = [
  'leads.create', 'leads.edit', 'leads.delete', 'leads.bulk_edit', 'leads.export', 'leads.convert',
  'deals.create', 'deals.edit', 'deals.delete', 'deals.bulk_edit', 'deals.export', 'deals.change_owner',
  'contacts.create', 'contacts.edit', 'contacts.delete', 'contacts.bulk_edit', 'contacts.export', 'contacts.merge',
  'activities.create', 'activities.edit', 'activities.delete', 'activities.bulk_edit', 'activities.export',
  'products.create', 'products.edit', 'products.delete', 'products.export',
  'projects.create', 'projects.edit', 'projects.delete', 'projects.export',
  'documents.create', 'documents.delete',
  'mail.send', 'mail.templates',
  'campaigns.manage', 'campaigns.send',
  'insights.view', 'insights.create', 'insights.share', 'insights.export', 'goals.manage',
  'automations.view', 'automations.manage',
  'sequences.manage',
  'data.import', 'data.export',
  'admin.settings', 'admin.users', 'admin.fields', 'admin.pipelines', 'admin.security', 'admin.api',
];

export const VISIBILITY = {
  OWNER: 1,
  OWNER_AND_GROUPS: 3,
  GROUPS_AND_SUB: 5,
  EVERYONE: 7,
};
export const VISIBILITY_LABELS = {
  1: 'Owner only',
  3: "Owner's visibility groups",
  5: 'Group and sub-groups',
  7: 'Entire company',
};

function descendantGroups(rootIds) {
  const edges = all('SELECT id, parent_id FROM visibility_groups');
  const out = new Set(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of edges) {
      if (e.parent_id !== null && out.has(e.parent_id) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return [...out];
}

/** Builds the full authorisation context for one user. Cheap enough to do per request. */
export function buildContext(user) {
  const sets = all(
    `SELECT ps.* FROM permission_sets ps
     JOIN user_permission_sets ups ON ups.permission_set_id = ps.id
     WHERE ups.user_id = ?`,
    user.id,
  );
  const perms = new Set();
  const modules = new Set();
  for (const s of sets) {
    const p = json(s.permissions, {});
    for (const [k, v] of Object.entries(p)) {
      if (!v) continue;
      if (k.startsWith('access.')) modules.add(k.slice(7));
      else perms.add(k);
    }
  }
  const myGroups = all('SELECT group_id FROM user_visibility_groups WHERE user_id=?', user.id).map((r) => r.group_id);
  const reachableGroups = descendantGroups(myGroups);
  const visibleUserIds = new Set([user.id]);
  if (reachableGroups.length) {
    for (const r of all(
      `SELECT DISTINCT user_id FROM user_visibility_groups WHERE group_id IN (${reachableGroups.map(() => '?').join(',')})`,
      ...reachableGroups,
    )) visibleUserIds.add(r.user_id);
  }

  const isAdmin = !!user.is_admin;
  const pipelineRestrictions = all('SELECT pipeline_id, group_id FROM pipeline_visibility');
  const restricted = new Map();
  for (const r of pipelineRestrictions) {
    if (!restricted.has(r.pipeline_id)) restricted.set(r.pipeline_id, new Set());
    restricted.get(r.pipeline_id).add(r.group_id);
  }
  const allPipelines = all('SELECT id FROM pipelines').map((p) => p.id);
  const visiblePipelines = isAdmin
    ? allPipelines
    : allPipelines.filter((pid) => {
      const groups = restricted.get(pid);
      if (!groups || groups.size === 0) return true;
      return myGroups.some((g) => groups.has(g));
    });

  return {
    user,
    isAdmin,
    permissionSets: sets.map((s) => ({ id: s.id, name: s.name })),
    permissions: perms,
    modules: isAdmin ? new Set(MODULES) : modules,
    groups: myGroups,
    reachableGroups,
    visibleUserIds: [...visibleUserIds],
    visiblePipelines,
  };
}

export function can(ctx, permission) {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  return ctx.permissions.has(permission);
}
export function assertCan(ctx, permission) {
  if (!can(ctx, permission)) throw forbidden(`Missing permission: ${permission}`);
}
export function canAccessModule(ctx, mod) {
  if (ctx.isAdmin) return true;
  return ctx.modules.has(mod);
}
export function assertModule(ctx, mod) {
  if (!canAccessModule(ctx, mod)) throw forbidden(`No access to module: ${mod}`);
}

/**
 * Layer 3 — record visibility. Returns a SQL fragment + params restricting rows
 * of `alias` (a table with owner_id + visible_to) to what ctx may see.
 */
export function visibilityClause(ctx, alias = 't') {
  if (ctx.isAdmin) return { sql: '1=1', params: [] };
  const ids = ctx.visibleUserIds.length ? ctx.visibleUserIds : [ctx.user.id];
  const placeholders = ids.map(() => '?').join(',');
  return {
    sql: `(${alias}.visible_to >= 7 OR ${alias}.owner_id = ? OR (${alias}.visible_to >= 3 AND ${alias}.owner_id IN (${placeholders})))`,
    params: [ctx.user.id, ...ids],
  };
}

export function canSeeRecord(ctx, row) {
  if (!row) return false;
  if (ctx.isAdmin) return true;
  if (row.visible_to === undefined || row.visible_to === null) return true;
  if (row.visible_to >= 7) return true;
  if (row.owner_id === ctx.user.id) return true;
  if (row.visible_to >= 3 && ctx.visibleUserIds.includes(row.owner_id)) return true;
  return false;
}
export function assertSeeRecord(ctx, row) {
  if (!canSeeRecord(ctx, row)) throw forbidden('Record not visible to you');
  return row;
}

export function canSeePipeline(ctx, pipelineId) {
  if (ctx.isAdmin) return true;
  return ctx.visiblePipelines.includes(Number(pipelineId));
}

export function describeContext(ctx) {
  return {
    user: {
      id: ctx.user.id, name: ctx.user.name, email: ctx.user.email,
      is_admin: !!ctx.user.is_admin, team_id: ctx.user.team_id,
      totp_enabled: !!ctx.user.totp_enabled, signature: ctx.user.signature,
    },
    permissions: [...ctx.permissions],
    modules: [...ctx.modules],
    permission_sets: ctx.permissionSets,
    visibility_groups: ctx.groups,
    visible_pipelines: ctx.visiblePipelines,
  };
}

export function defaultPermissionSets() {
  const full = {};
  for (const p of PERMISSIONS) full[p] = true;
  for (const m of MODULES) full['access.' + m] = true;

  const manager = { ...full };
  delete manager['admin.security'];
  delete manager['admin.api'];
  manager['access.admin'] = true;

  const rep = {};
  for (const p of PERMISSIONS) {
    if (p.startsWith('admin.')) continue;
    if (p === 'campaigns.manage' || p === 'campaigns.send') continue;
    if (p === 'automations.manage') continue;
    rep[p] = true;
  }
  rep['automations.view'] = true;
  for (const m of MODULES) if (m !== 'admin' && m !== 'campaigns') rep['access.' + m] = true;

  const readonly = {};
  for (const m of MODULES) if (m !== 'admin') readonly['access.' + m] = true;
  readonly['insights.view'] = true;
  readonly['automations.view'] = true;

  return [
    { name: 'Admin', description: 'Full access to every module and setting', permissions: full, is_system: 1 },
    { name: 'Sales manager', description: 'Everything except security and API administration', permissions: manager, is_system: 1 },
    { name: 'Sales rep', description: 'Day-to-day selling: records, activities, mail, reports', permissions: rep, is_system: 1 },
    { name: 'Read only', description: 'View records and reports, change nothing', permissions: readonly, is_system: 1 },
  ];
}
