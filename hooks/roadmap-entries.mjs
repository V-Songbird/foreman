// The pane's reader of ROADMAP.jsonl, kept free of Claude Code's module API so Node can run it too:
// tests/desktop_mod.test.js feeds it files written by roadmap.js.

export const CLOSED = new Set(["done", "dropped", "rejected"]);

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/**
 * The open and the deferred entries of a ROADMAP.jsonl text; an id it does not list counts as done.
 * @param {string} text
 * @returns {{ entries: import("../types").Entry[], deferred: import("../types").Entry[] }}
 */
export function parse(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const { id, status } = row;
    if (typeof id !== "string" || typeof status !== "string" || CLOSED.has(status)) continue;
    rows.push({
      id,
      title: String(row.title ?? ""),
      status,
      dependsOn: strings(row.depends_on),
      touches: strings(row.planned_touches),
      why: String(row.why ?? ""),
      createdAt: String(row.created_at ?? ""),
      source: String(row.source ?? ""),
    });
  }
  const open = new Set(rows.map((r) => r.id));
  const all = rows.map((r) => ({ ...r, waitsOn: r.dependsOn.filter((d) => open.has(d)) }));
  return { entries: all.filter((x) => x.status !== "deferred"), deferred: all.filter((x) => x.status === "deferred") };
}
