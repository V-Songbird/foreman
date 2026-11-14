import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RoadmapEntry as Entry, RoadmapSection as Section } from '../types'
import { parse } from './roadmap-entries.mjs'

const PANE = 'foreman-roadmap'
const FILE = 'ROADMAP.jsonl'
// $.fs.read rejects a file over 4 MiB.
const READ_MAX = 4 * 1024 * 1024
const LIST_MAX = 12
const TOUCH_MAX = 3
// Only an id of this shape goes into a prompt the pane writes.
const SAFE_ID = /^[A-Za-z0-9._-]{1,32}$/

// Change the tag when Board's fields change: it declines what an earlier version stored.
const board = atom({ plugin: 'foreman', key: 'roadmapBoard' } as const, null, { shape: 'board-1' })
const error = atom({ plugin: 'foreman', key: 'roadmapError' } as const, null)
const view = atom({ plugin: 'foreman', key: 'roadmapView' } as const, {
  active: { isOpen: true, rows: LIST_MAX },
  ready: { isOpen: true, rows: LIST_MAX },
  blocked: { isOpen: false, rows: LIST_MAX },
  deferred: { isOpen: false, rows: LIST_MAX },
})
const sent = atom({ plugin: 'foreman', key: 'roadmapSent' } as const, {})
const picked = atom({ plugin: 'foreman', key: 'roadmapPicked' } as const, null)
const query = atom({ plugin: 'foreman', key: 'roadmapQuery' } as const, '')
const hasRoadmap = atom({ plugin: 'foreman', key: 'roadmapExists' } as const, false)
const isOpen = atom({ plugin: 'foreman', key: 'roadmapOpen' } as const, false)

/** What the pane says, by language. English is the complete base. */
export const EN = {
  readFailed: (file: string, why: string) => `Could not read ${file}: ${why}`,
  tooBig: (file: string) => `${file} is too large to show here. Ask Foreman to archive the finished tasks.`,
  unreadable: (file: string) => `${file} has a line Foreman cannot read, so this list could be incomplete. Ask Foreman to check the roadmap.`,
  refresh: 'Refresh',
  reading: 'Reading the roadmap…',
  verb: { resume: 'Resume', accept: 'Accept', pick: 'Pick' },
  // One request for every button: Foreman's pick flow routes a named entry by its status.
  ask: (id: string) => `Pick roadmap entry ${id} with Foreman.`,
  inProgress: 'in progress',
  awaiting: 'awaiting your acceptance',
  waitsOn: (ids: string) => `waits on ${ids}`,
  deferredOne: 'deferred',
  readyOne: 'ready',
  done: (ids: string, n: number) => `${ids} (done)`,
  you: 'You',
  suggested: 'Suggested',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  date: (day: number, month: string) => `${month} ${day}`,
  sent: (status: string) => `sent · ${status}`,
  divider: 'Divider',
  task: (id: string) => `Task ${id}`,
  close: 'Close',
  status: 'Status',
  created: 'Created',
  dependsOn: 'Depends on',
  files: 'Files',
  moreFiles: (n: number) => `and ${n} more`,
  toPrompt: 'To prompt',
  showMore: (n: number, of: number) => `show ${n} more of ${of}`,
  showRest: (n: number) => `show ${n} more`,
  search: 'Search by ID, name or description',
  open: 'open',
  openCount: (n: number) => `${n} open`,
  readyCount: (n: number) => `${n} ready to start`,
  noHits: (q: string) => `No task matches “${q}”.`,
  active: 'In progress',
  noneActive: 'Nothing in progress.',
  ready: 'Ready',
  noneReady: 'None ready.',
  blocked: 'Blocked',
  noneBlocked: 'None blocked.',
  deferred: 'Deferred',
  noneDeferred: 'None deferred.',
  readAt: (time: string) => `read ${time}`,
}
export const ES: typeof EN = {
  readFailed: (file, why) => `No pude leer ${file}: ${why}`,
  tooBig: file => `${file} es demasiado grande para mostrarse aquí. Pide a Foreman que archive las tareas terminadas.`,
  unreadable: file => `${file} tiene una línea que Foreman no puede leer, así que esta lista podría estar incompleta. Pide a Foreman que revise el roadmap.`,
  refresh: 'Actualizar',
  reading: 'Leyendo el roadmap…',
  verb: { resume: 'Reanudar', accept: 'Aceptar', pick: 'Elegir' },
  ask: id => `Elige la entrada ${id} del roadmap con Foreman.`,
  inProgress: 'en curso',
  awaiting: 'espera tu aceptación',
  waitsOn: ids => `espera ${ids}`,
  deferredOne: 'aplazada',
  readyOne: 'lista',
  done: (ids, n) => `${ids} (${n === 1 ? 'hecha' : 'hechas'})`,
  you: 'Tú',
  suggested: 'Sugerida',
  months: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  date: (day, month) => `${day} ${month}`,
  sent: status => `enviada · ${status}`,
  divider: 'Separador',
  task: id => `Tarea ${id}`,
  close: 'Cerrar',
  status: 'Estado',
  created: 'Creada',
  dependsOn: 'Depende de',
  files: 'Archivos',
  moreFiles: n => `y ${n} más`,
  toPrompt: 'Al prompt',
  showMore: (n, of) => `ver ${n} más de ${of}`,
  showRest: n => `ver ${n} más`,
  search: 'Buscar por ID, nombre o descripción',
  open: 'abrir',
  openCount: n => `${n} ${n === 1 ? 'abierta' : 'abiertas'}`,
  readyCount: n => `${n} ${n === 1 ? 'lista' : 'listas'} para empezar`,
  noHits: q => `Ninguna tarea coincide con “${q}”.`,
  active: 'En curso',
  noneActive: 'Nada en curso.',
  ready: 'Listas',
  noneReady: 'Ninguna lista.',
  blocked: 'Bloqueadas',
  noneBlocked: 'Ninguna bloqueada.',
  deferred: 'Aplazadas',
  noneDeferred: 'Ninguna aplazada.',
  readAt: time => `leído ${time}`,
}
type Strings = typeof EN
type Action = keyof Strings['verb']

/** Whether Claude Code's `language` setting, free text such as "Español", "Spanish" or "es-MX", names Spanish. */
export const isSpanish = (v: unknown): boolean => {
  if (typeof v !== 'string') return false
  const t = v.trim().toLowerCase()
  return /^es(?:$|[-_])/.test(t) || ['en', 'es'].some(d => t.startsWith(new Intl.DisplayNames([d], { type: 'language' }).of('es')!.toLowerCase()))
}

/** The pane's strings for the `language` setting; English when it is unset, unknown or unreadable. */
async function stringsOf($: EngineInterface): Promise<Strings> {
  try {
    return isSpanish(await $.settings.read({ key: 'language' })) ? ES : EN
  } catch {
    return EN
  }
}

/** What Foreman can do with an entry from the pane, or undefined when nothing. */
export const actionFor = (x: Entry): Action | undefined =>
  !SAFE_ID.test(x.id) ? undefined
    : x.status === 'in_progress' ? 'resume'
    : x.status === 'awaiting_acceptance' ? 'accept'
    : x.status === 'planned' && x.waitsOn.length === 0 ? 'pick'
    : undefined

// A request this pane wrote earlier, in either language, at the start of the prompt box.
const OWN = new RegExp(
  `^(?:${[EN.ask, ES.ask]
    .map(ask => ask('\u0001').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\u0001', '\\S+'))
    .join('|')})\\s*`,
)

/** The prompt box after a fill: the request, then the person's draft, which Foreman reads as a hint. A request this pane wrote earlier is replaced. */
export const draftWith = (ask: string, draft: string): string => {
  const rest = draft.replace(OWN, '').trim()
  return rest ? `${ask} ${rest}` : ask
}

/** The folder Foreman works in, as its hooks resolve it (hooks/lib.js projectDir): FOREMAN_PROJECT_DIR, then CLAUDE_PROJECT_DIR, then the session's own. */
const rootOf = async ($: EngineInterface): Promise<string> => {
  // A variable the engine will not read counts as unset, so the pane still finds the session's folder.
  // The engine takes only a literal name, so each read is written out.
  const none = () => undefined

  return (await $.env.get('FOREMAN_PROJECT_DIR').catch(none)) || (await $.env.get('CLAUDE_PROJECT_DIR').catch(none)) || (await $.session.root())
}

/** Reads the roadmap; unless forced, only when its size or mtime changed since the last read. Resolves whether the file exists. */
const load = async ($: EngineInterface, force = true): Promise<boolean> => {
  const t = await stringsOf($)
  try {
    const root = await rootOf($)
    const path = `${root}/${FILE}`
    if (!(await $.fs.exists(path))) {
      await update($, hasRoadmap, () => false)
      await update($, board, () => null)
      await update($, error, () => null)
      if (await read($, isOpen)) await close($)
      return false
    }
    const { size, mtimeMs } = await $.fs.stat(path)
    const last = await read($, board)
    if (!force && last?.root === root && last.size === size && last.mtimeMs === mtimeMs) return true
    if (size > READ_MAX) {
      await update($, error, () => t.tooBig(FILE))
      return true
    }
    const { entries, deferred, unreadable } = parse(await $.fs.read(path))
    const readAt = await $.clock.now()
    await update($, board, () => ({ root, entries, deferred, readAt, mtimeMs, size }))
    await update($, error, () => (unreadable > 0 ? t.unreadable(FILE) : null))
    // A status change ends an entry's sent mark at once; the next turn ends the rest.
    const status = new Map([...entries, ...deferred].map(x => [x.id, x.status]))
    await update($, sent, s => Object.fromEntries(Object.entries(s).filter(([id, was]) => status.get(id) === was)))
  } catch (err) {
    await update($, error, () => t.readFailed(FILE, err instanceof Error ? err.message : String(err)))
  }
  return true
}

/** Whether the project has a roadmap, for the footer button. */
const check = async ($: EngineInterface): Promise<void> => {
  try {
    const exists = await $.fs.exists(`${await rootOf($)}/${FILE}`)
    await update($, hasRoadmap, () => exists)
  } catch {
    await update($, hasRoadmap, () => false)
  }
}

/** Reads the roadmap and opens the pane. */
const open = async ($: EngineInterface): Promise<void> => {
  if (!(await load($))) return
  try {
    await $.ui.open({ id: PANE, title: 'Roadmap' })
  } catch {
    return
  }
  await update($, isOpen, () => true)
}

/** Closes the pane; its reads stop. The ui.close hook covers closes the person makes. */
const close = async ($: EngineInterface): Promise<void> => {
  await $.ui.close({ id: PANE })
  await update($, isOpen, () => false)
}

/** What the pane asks of Foreman for an entry, in the person's language. */
const askOf = async ($: EngineInterface, id: string): Promise<string> => (await stringsOf($)).ask(id)

/** Puts the request in the prompt box, keeping what the person typed there. */
const fill = async ($: EngineInterface, ask: string): Promise<void> => {
  const box = await $.prompt.read()
  await $.prompt.fill({ text: draftWith(ask, box.text), mode: 'replace' })
}

/** Marks the entry as sent and submits the request as the person's own prompt; unmarks it if the prompt does not enter. */
const send = async ($: EngineInterface, x: Entry, ask: string): Promise<void> => {
  await update($, sent, s => ({ ...s, [x.id]: x.status }))
  let entered = false
  try {
    entered = (await $.prompt.submit({ text: ask, asUser: true })).drop === undefined
  } catch {
    entered = false
  }
  if (!entered) await update($, sent, s => Object.fromEntries(Object.entries(s).filter(([id]) => id !== x.id)))
}

const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…` : s)

// The dot of an entry sent to Foreman, until the next turn.
const SENT = 'suggestion'
// The detail card's reason, cut so a long one leaves the list some rows.
const WHY_MAX = 200

// One color per section, for the summary bar, the section squares and the row dots. Each section also has its name,
// so the color is never the only signal.
const FILL = {
  active: 'ide',
  ready: 'success',
  blocked: 'warning',
  deferred: 'subtle',
} as const

const fillOf = (x: Entry): string =>
  x.status === 'deferred' ? FILL.deferred
    : x.status !== 'planned' ? FILL.active
    : x.waitsOn.length > 0 ? FILL.blocked
    : FILL.ready

const statusOf = (x: Entry, t: Strings): string =>
  x.status === 'in_progress' ? t.inProgress
    : x.status === 'awaiting_acceptance' ? t.awaiting
    : x.waitsOn.length > 0 ? t.waitsOn(x.waitsOn.join(', '))
    : x.status === 'deferred' ? t.deferredOne
    : x.status === 'planned' ? t.readyOne
    : x.status

/** The dependencies an entry no longer waits on, said as done, as "235, 236 (done)". */
const metOf = (x: Entry, t: Strings): string => {
  const met = x.dependsOn.filter(d => !x.waitsOn.includes(d))
  return met.length === 0 ? '' : t.done(met.join(', '), met.length)
}

/** When and by whom an entry was made, as "Nov 3 · You"; empty when the file does not say. */
const madeOf = (x: Entry, t: Strings): string => {
  const [, m, d] = /^\d{4}-(\d{2})-(\d{2})/.exec(x.createdAt) ?? []
  const who = x.source === 'user' ? t.you : x.source.endsWith('-suggested') ? t.suggested : x.source
  const month = m ? t.months[Number(m) - 1] : undefined
  return [month && d ? t.date(Number(d), month) : '', who].filter(Boolean).join(' · ')
}

/** Text folded for search: lower case, accents dropped, so "descripcion" finds "descripción". */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Whether an entry's id, title or reason contains the search text; a leading "#" on an id is ignored. */
const matches = (x: Entry, q: string): boolean => {
  const t = fold(q.trim()).replace(/^#/, '')
  return t === '' || [x.id, x.title, x.why].some(f => fold(f).includes(t))
}

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** A planned file as the session panel lists results: its name, then the folder it sits in. */
const fileOf = (path: string): string => {
  const parts = path.replace(/\/$/, '').split('/')
  const name = parts.pop() ?? path
  return parts.length === 0 ? path : `${name}${path.endsWith('/') ? '/' : ''} · ${parts.join('/')}`
}

// The session panel's 1px section divider. A Box sizes in rows, so it would land between pixels;
// an Svg is drawn in CSS pixels, stretched to the pane, in the ink the surface gives it.
const DIVIDER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="1" viewBox="0 0 4096 1" preserveAspectRatio="none">' +
  '<rect width="4096" height="1" fill="currentColor" fill-opacity=".06"/></svg>'

const reset = async ($: EngineInterface): Promise<void> => {
  await update($, board, () => null)
  await update($, error, () => null)
  await update($, view, () => view.initial)
  await update($, sent, () => sent.initial)
  await update($, picked, () => null)
  await update($, query, () => '')
  await update($, isOpen, () => false)
  await check($)
}

export const register: Register = on => {
  // Start from nothing, at a session start and at a /clear, which raises no session.start: the state keeps what an earlier session left.
  on('session.start', async ($, e, next) => {
    await reset($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await reset($)
    return next(e)
  })

  // The pane's button beside the mode labels at the right of the prompt footer, in a project with a roadmap.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, hasRoadmap))) return r
    const { Box, Button } = $.ui.resolve(e)
    const up = await read($, isOpen)
    return (
      <Box flexDirection="row" gap={1}>
        {r}
        <Button key="roadmap-toggle" plain dimColor={!up} onPress={() => (up ? close($) : open($))}>Roadmap</Button>
      </Box>
    )
  })

  // However the pane closes (the person closing it, the toggle, Escape), stop reading the file.
  on('ui.close', async ($, e, next) => {
    const r = await next(e)
    if (e.id === PANE) await update($, isOpen, () => false)
    return r
  })

  // Foreman edits the file during a turn; read it again once the turn ends, if the pane is open.
  // Closed, only look for the file, so the button appears once /foreman:init writes it.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      // The request is answered by now: bring the card's buttons back.
      await update($, sent, () => ({}))
      await ((await read($, isOpen)) ? load($, false) : check($))
    }
    return r
  })

  // Foreman writes the file through its roadmap.js script, run from a shell: catch the change mid-turn. No file-watch event exists.
  on('tool.call', { tool: /^(Bash|PowerShell)$/ }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && (await read($, isOpen))) await load($, false)
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const b = await read($, board)
    const err = await read($, error)
    const v = await read($, view)
    const s = await read($, sent)
    const p = await read($, picked)
    const q = await read($, query)
    const isSearching = q.trim() !== ''
    const t = await stringsOf($)
    const isTerminal = e.surface === 'terminal'
    // The desktop app seats a minimized pane as 'widget', a value the terminal's types leave out.
    const isWidget = (e.props.placement as string) === 'widget'
    const refresh = <Button key="refresh" label={t.refresh} onPress={() => load($)} />

    if (err !== null) {
      return (
        <Box flexDirection="column" gap="md">
          <Text>{err}</Text>
          {!isWidget && <Box>{refresh}</Box>}
        </Box>
      )
    }
    if (b === null) return <Text color="subtle">{t.reading}</Text>

    const active = b.entries.filter(x => x.status !== 'planned')
    const ready = b.entries.filter(x => x.status === 'planned' && x.waitsOn.length === 0)
    const blocked = b.entries.filter(x => x.status === 'planned' && x.waitsOn.length > 0)

    const pick = (id: string | null) => update($, picked, () => id)
    // Two entries can share an id: the second row's key says so.
    const used = new Map<string, number>()

    // A row is its dot, its id and its title on one line: a press shows the entry's card, a second press hides it.
    // The terminal wraps a long Button label, so there the title is cut to the columns left after "● <id> ".
    const row = (x: Entry) => {
      const isSent = x.id in s
      const n = (used.get(x.id) ?? 0) + 1
      used.set(x.id, n)
      const key = n === 1 ? x.id : `${x.id}#${n}`
      const title = isTerminal ? cut(x.title, e.props.bodyColumns - x.id.length - 4) : x.title
      return (
        <Box key={`row-${key}`} flexDirection="row" gap={1} paddingLeft={1}>
          <Text color={isSent ? SENT : fillOf(x)}>●</Text>
          {/* A Button draws its content as one line of text at its natural width; minWidth 0 holds it to the pane, */}
          {/* so a long title ends in "…", as the session sidebar's do. The card shows it whole. */}
          <Box flexGrow={1} minWidth={0}>
            <Button key={key} plain dimColor={isSent} hover={{ underline: true }} onPress={() => pick(p === x.id ? null : x.id)}>
              <Text color="subtle">{x.id} </Text>
              <Text weight={p === x.id ? 'medium' : 'regular'}>{title}</Text>
            </Button>
          </Box>
        </Box>
      )
    }

    // One line of the card, as the session panel's rows: a secondary label at the left, a muted value at the right.
    const field = (key: string, label: string, value: ReturnType<typeof Text> | string) => (
      <Box key={`card-${key}`} flexDirection="row" justifyContent="space-between" gap={1}>
        <Text size="footnote" dimColor>{label}</Text>
        {typeof value === 'string' ? <Text size="footnote" color="subtle" wrap="truncate-end">{value}</Text> : value}
      </Box>
    )

    // The picked entry as a section of its own at the pane's foot, like the session panel's: a divider, a small head in the main ink,
    // the title, label and value rows, one line per planned file, the reason, then what Foreman can do with it.
    const card = (x: Entry) => {
      const action = actionFor(x)
      const isSent = x.id in s
      const made = madeOf(x, t)
      const met = metOf(x, t)
      const state = (
        <Text size="footnote">
          <Text color={isSent ? SENT : fillOf(x)}>● </Text>
          <Text color="subtle">{capital(isSent ? t.sent(statusOf(x, t)) : statusOf(x, t))}</Text>
        </Text>
      )
      return (
        <Box key="card" flexDirection="column" flexShrink={0} gap="xs">
          {!isTerminal && 'Svg' in ui && <ui.Svg source={DIVIDER} alt={t.divider} width={4096} height={1} />}
          <Box key="card-head" flexDirection="row" justifyContent="space-between" alignItems="center">
            <Text size="footnote">{t.task(x.id)}</Text>
            <Button key="card-close" plain dimColor label={t.close} onPress={() => pick(null)} />
          </Box>
          <Box key="card-title"><Text weight="medium">{x.title}</Text></Box>
          {field('state', t.status, state)}
          {made && field('made', t.created, made)}
          {met && field('met', t.dependsOn, met)}
          {x.touches.length > 0 && field('files', t.files, String(x.touches.length))}
          {x.touches.slice(0, TOUCH_MAX).map(f => (
            <Box key={`card-file-${f}`} paddingLeft={1.5}>
              <Text size="footnote" color="subtle" wrap="truncate-end">{fileOf(f)}</Text>
            </Box>
          ))}
          {x.touches.length > TOUCH_MAX && (
            <Box key="card-file-more" paddingLeft={1.5}>
              <Text size="footnote" color="subtle">{t.moreFiles(x.touches.length - TOUCH_MAX)}</Text>
            </Box>
          )}
          {x.why && <Box key="card-why"><Text size="footnote" dimColor>{cut(x.why, WHY_MAX)}</Text></Box>}
          {action !== undefined && !isSent && (
            // As the session panel's compaction row: the quiet action at the left, the button at the right.
            <Box key="card-actions" flexDirection="row" justifyContent="space-between" alignItems="center" gap={1}>
              <Button key={`fill-${x.id}`} plain dimColor label={t.toPrompt} onPress={async () => fill($, await askOf($, x.id))} />
              <Button key={`send-${x.id}`} label={t.verb[action]} onPress={async () => send($, x, await askOf($, x.id))} />
            </Box>
          )}
        </Box>
      )
    }

    const section = (id: Section, title: string, list: Entry[], empty: string, color: string) => {
      // A search opens every section that has a match and hides the rest; its heads then cannot close.
      if (isSearching && list.length === 0) return null
      const { rows } = v[id]
      const expanded = isSearching || v[id].isOpen
      const toggle = () => update($, view, w => ({ ...w, [id]: { ...w[id], isOpen: !w[id].isOpen } }))
      const more = () => update($, view, w => ({ ...w, [id]: { ...w[id], rows: w[id].rows + LIST_MAX } }))
      const rest = list.length - rows
      return (
        <Box key={id} flexDirection="column">
          {/* Like the session panel's section heads: a square in the section's color, a secondary label that lights up on hover, */}
          {/* a small triangle after it, the count muted. The triangle is a glyph inside the Button, so a press on it toggles too. */}
          <Box key={`head-${id}`} flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box key={`lead-${id}`} flexDirection="row" alignItems="center">
              <Text color={color}>■ </Text>
              {isSearching
                ? <Box key={`sec-${id}`}><Text dimColor>{title}</Text></Box>
                : <Button key={`sec-${id}`} plain dimColor onPress={toggle}>{`${title} ${expanded ? '▾' : '▸'}`}</Button>}
            </Box>
            <Box key={`count-${id}`}><Text size="footnote" color="subtle" tabular>{String(list.length)}</Text></Box>
          </Box>
          {expanded && list.length === 0 && <Box paddingLeft={2}><Text color="subtle">{empty}</Text></Box>}
          {expanded && list.slice(0, rows).map(row)}
          {expanded && rest > 0 && (
            <Box paddingLeft={2}>
              <Button key={`more-${id}`} plain dimColor onPress={more}>{rest > LIST_MAX ? t.showMore(LIST_MAX, rest) : t.showRest(rest)}</Button>
            </Box>
          )}
        </Box>
      )
    }

    const total = active.length + ready.length + blocked.length
    const time = new Date(b.readAt).toTimeString().slice(0, 5)
    const parts = [
      { n: active.length, color: FILL.active },
      { n: ready.length, color: FILL.ready },
      { n: blocked.length, color: FILL.blocked },
    ].filter(p => p.n > 0)
    const shown = [...b.entries, ...b.deferred].find(x => x.id === p)
    const found = (list: Entry[]) => list.filter(x => matches(x, q))
    const hits = [...active, ...ready, ...blocked, ...b.deferred].filter(x => matches(x, q))
    // On Desktop the tree is at least as tall as the pane (bodyRows counts the same row unit a Box height does), so the
    // footer stays at the foot with or without a card. With a card it is exactly that tall: the card and footer keep
    // their height at the foot, and the list takes the rest, clipped: it does not scroll then.
    const isPinned = !isTerminal && shown !== undefined
    const { bodyRows } = e.props.scroll

    const summary = (
          <Box key="summary" flexDirection="column" gap="xs">
            {/* Like the session panel's headline: the count regular, the summary as a muted footnote. */}
            <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
              <Text tabular>{t.openCount(total)}</Text>
              <Text size="footnote" color="subtle" tabular>{t.readyCount(ready.length)}</Text>
            </Box>
            {total > 0 && (
              // Like the session panel's context bar (a 4px stacked meter): square pieces with a 1px seam, round only at the ends.
              // Desktop rounds a Box only through a `round` border, so the bar wears one in the track's own color, padding undone,
              // and clips its pieces to it. Pieces grow by their count, so the seams never push the bar past its width.
              // The terminal draws plain cells.
              <Box
                key="bar"
                flexDirection="row"
                {...(isTerminal ? { height: 1 } : {
                  height: 0.32,
                  flexShrink: 0,
                  columnGap: 0.15,
                  overflow: 'hidden' as const,
                  borderStyle: 'round' as const,
                  borderColor: 'promptBorder',
                  backgroundColor: 'promptBorder',
                  padding: 0 as const,
                })}
              >
                {parts.map(p => <Box key={`bar-${p.color}`} width={0} flexGrow={p.n} backgroundColor={p.color} />)}
              </Box>
            )}
          </Box>
    )
    // A minimized pane is a small card the app may not pass clicks to: counts and bar only.
    if (isWidget) return summary

    return (
      <Box flexDirection="column" gap="md" {...(isTerminal ? {} : isPinned ? { height: bodyRows } : { minHeight: bodyRows })}>
        {/* Typing filters the sections as you go; Enter opens the card of the first match. Desktop gives a one-line */}
        {/* field its own fixed width, which no prop changes. Its focus glow reaches about 8px out, and the pane clips */}
        {/* what rises above its top, so the field starts a little lower. */}
        {'Input' in ui && (
          <Box key="search-row" flexShrink={0} marginTop={isTerminal ? 0 : 0.4}>
            <ui.Input
              key="search"
              placeholder={t.search}
              value={q}
              submitLabel={t.open}
              onInput={(text: string) => update($, query, () => text)}
              onSubmit={(text: string) => {
                const first = [...active, ...ready, ...blocked, ...b.deferred].find(x => matches(x, text))
                return Promise.all([update($, query, () => text), first && pick(first.id)])
              }}
            />
          </Box>
        )}
        {summary}
        <Box key="list" flexDirection="column" gap="md" {...(isTerminal ? {} : isPinned ? { flexGrow: 1, minHeight: 0, overflow: 'hidden' as const } : { flexGrow: 1 })}>
          {isSearching && hits.length === 0 && (
            <Box key="no-hits"><Text color="subtle">{t.noHits(q.trim())}</Text></Box>
          )}
          {section('active', t.active, found(active), t.noneActive, FILL.active)}
          {section('ready', t.ready, found(ready), t.noneReady, FILL.ready)}
          {section('blocked', t.blocked, found(blocked), t.noneBlocked, FILL.blocked)}
          {section('deferred', t.deferred, found(b.deferred), t.noneDeferred, FILL.deferred)}
        </Box>
        {shown !== undefined && card(shown)}
        <Box flexShrink={0} flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text color="subtle">{t.readAt(time)}</Text>
          {refresh}
        </Box>
      </Box>
    )
  })
}
