/**
 * Domain event bus. Emitters never know about automations or webhooks;
 * those subscribe here. Depth is tracked so an automation that writes a record
 * cannot trigger itself into an infinite loop.
 */
const listeners = [];
export function onEvent(fn) { listeners.push(fn); }

export const MAX_DEPTH = 4;

/**
 * @param {string} name  e.g. 'deal.created', 'deal.updated', 'deal.stage_changed'
 * @param {object} payload { entity, id, record, before, changes, actor, depth, source }
 */
export function emit(name, payload = {}) {
  const depth = payload.depth ?? 0;
  if (depth > MAX_DEPTH) {
    console.warn(`[events] dropping ${name} — max automation depth reached`);
    return;
  }
  for (const fn of listeners) {
    try {
      fn(name, { ...payload, depth });
    } catch (err) {
      console.error(`[events] listener failed for ${name}:`, err.message);
    }
  }
}
