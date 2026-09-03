import { all, get, insert, run, nowIso, json } from './db.mjs';

const handlers = new Map();
export function registerJob(kind, fn) { handlers.set(kind, fn); }

export function enqueue(kind, payload = {}, runAt = null) {
  return insert('jobs', {
    kind,
    payload: JSON.stringify(payload),
    run_at: runAt || nowIso(),
  });
}

const MAX_ATTEMPTS = 4;
let ticking = false;

export async function tick(limit = 25) {
  if (ticking) return 0;
  ticking = true;
  let processed = 0;
  try {
    const due = all(
      "SELECT * FROM jobs WHERE status='pending' AND run_at <= datetime('now') ORDER BY run_at LIMIT ?",
      limit,
    );
    for (const job of due) {
      run("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=?", job.id);
      const fn = handlers.get(job.kind);
      if (!fn) {
        run("UPDATE jobs SET status='failed', last_error=? WHERE id=?", `No handler for ${job.kind}`, job.id);
        continue;
      }
      try {
        await fn(json(job.payload, {}), job);
        run("UPDATE jobs SET status='done', last_error=NULL WHERE id=?", job.id);
      } catch (err) {
        const attempts = job.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          run("UPDATE jobs SET status='failed', last_error=? WHERE id=?", String(err.message || err), job.id);
        } else {
          const backoff = new Date(Date.now() + 2 ** attempts * 15000).toISOString().slice(0, 19).replace('T', ' ');
          run("UPDATE jobs SET status='pending', run_at=?, last_error=? WHERE id=?", backoff, String(err.message || err), job.id);
        }
      }
      processed++;
    }
  } finally {
    ticking = false;
  }
  return processed;
}

let timer = null;
export function startWorker(intervalMs = 5000, extraTicks = []) {
  if (timer) return;
  const cycle = async () => {
    try {
      await tick();
      for (const fn of extraTicks) await fn();
    } catch (err) {
      console.error('[worker]', err);
    }
  };
  timer = setInterval(cycle, intervalMs);
  timer.unref?.();
  cycle();
}
export function stopWorker() { if (timer) { clearInterval(timer); timer = null; } }

export function jobStats() {
  return {
    pending: get("SELECT COUNT(*) n FROM jobs WHERE status='pending'").n,
    running: get("SELECT COUNT(*) n FROM jobs WHERE status='running'").n,
    failed: get("SELECT COUNT(*) n FROM jobs WHERE status='failed'").n,
    done: get("SELECT COUNT(*) n FROM jobs WHERE status='done'").n,
    recent_failures: all("SELECT id, kind, last_error, created_at FROM jobs WHERE status='failed' ORDER BY id DESC LIMIT 10"),
  };
}
