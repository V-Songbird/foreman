// The pane's reader of ROADMAP.jsonl, kept free of Claude Code's module API so Node can run it too:
// tests/desktop_mod.test.js feeds it files written by roadmap.js.

export const CLOSED = new Set(['done', 'dropped', 'rejected'])

const strings = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])

/**
 * The open and the deferred entries of a ROADMAP.jsonl text, and how many lines it could not read; an id it does not list counts as done.
 * @param {string} text
 * @returns {{ entries: import('../types').RoadmapEntry[], deferred: import('../types').RoadmapEntry[], unreadable: number }}
 */
export function parse(text) {
  const rows = []
  let unreadable = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      unreadable++
      continue
    }
    if (!row || typeof row !== 'object') {
      unreadable++
      continue
    }
    const { id, status } = row
    // The format marker has no id; any other line without one is not an entry Foreman can use.
    if (typeof id !== 'string' || typeof status !== 'string') {
      if (!('foreman_roadmap_format' in row)) unreadable++
      continue
    }
    if (CLOSED.has(status)) continue
    rows.push({
      id,
      title: String(row.title ?? ''),
      status,
      dependsOn: strings(row.depends_on),
      touches: strings(row.planned_touches ?? row.touches),
      why: String(row.why ?? ''),
      createdAt: String(row.created_at ?? ''),
      source: String(row.source ?? ''),
    })
  }
  const open = new Set(rows.map(r => r.id))
  const all = rows.map(r => ({ ...r, waitsOn: r.dependsOn.filter(d => open.has(d)) }))
  return { entries: all.filter(x => x.status !== 'deferred'), deferred: all.filter(x => x.status === 'deferred'), unreadable }
}
