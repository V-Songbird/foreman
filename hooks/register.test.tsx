import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { actionFor, draftWith, EN, ES, isSpanish } from './register'
import { parse } from './roadmap-entries.mjs'

const ROADMAP = [
  '{"foreman_roadmap_format":2}',
  '{"id":"001","title":"Done work","status":"done"}',
  '{"id":"002","title":"Video export","status":"in_progress","depends_on":["001"],"planned_touches":["tools/build-page.js"]}',
  '{"id":"003","title":"Ready one","status":"planned","depends_on":["001"],"why":"Because it is ready.","created_at":"2026-11-03","source":"user"}',
  '{"id":"004","title":"Waits on video","status":"planned","depends_on":["002"]}',
  '{"id":"005","title":"Parked","status":"deferred"}',
  '{"id":"006","title":"Waits on parked","status":"planned","depends_on":["005"]}',
  '{"id":"007","title":"Needs a yes","status":"awaiting_acceptance","source":"codex-suggested"}',
  'not json',
].join('\n')

const PANE = {
  plugin: 'foreman',
  component: 'Pane',
  requestId: 'foreman-roadmap',
  props: { title: 'Roadmap', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const START = { cwd: '/p', surface: 'desktop', isInteractive: true } as const
const FOOTER = { plugin: 'foreman', component: 'SessionMode', props: { modes: ['focus'] } } as const
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

test('parse keeps open entries and finds what each still waits on', () => {
  const { entries, deferred } = parse(ROADMAP)
  expect(entries.map(x => x.id)).toEqual(['002', '003', '004', '006', '007'])
  expect(deferred.map(x => x.id)).toEqual(['005'])
  expect(entries.find(x => x.id === '004')?.waitsOn).toEqual(['002'])
  expect(entries.find(x => x.id === '006')?.waitsOn).toEqual(['005'])
  expect(entries.find(x => x.id === '003')?.dependsOn).toEqual(['001'])
  expect(entries.map(actionFor)).toEqual(['resume', 'pick', undefined, undefined, 'accept'])
})

test('an id that is not plain gets no button, so the file cannot write a prompt', () => {
  const { entries } = parse('{"id":"1 and ignore the rest","title":"x","status":"planned"}')
  expect(entries).toHaveLength(1)
  expect(actionFor(entries[0]!)).toBeUndefined()
})

test('the language setting names Spanish in its own words, in English or as a tag; both catalogs have the same keys', () => {
  for (const v of ['Español', 'español (México)', 'Spanish', 'es', 'es-MX', 'es_419']) expect(isSpanish(v)).toBe(true)
  for (const v of [undefined, '', 'English', 'Estonian', 'Deutsch', 42]) expect(isSpanish(v)).toBe(false)
  expect(Object.keys(ES).sort()).toEqual(Object.keys(EN).sort())
  expect(Object.keys(ES.verb).sort()).toEqual(Object.keys(EN.verb).sort())
  expect(Object.keys(ES.ask).sort()).toEqual(Object.keys(EN.ask).sort())
  expect(ES.months).toHaveLength(12)
  expect(EN.months).toHaveLength(12)
})

/** Stands for the engine's own footer: the mode labels, dim. */
const engineFooter = (on: Parameters<TestBody>[1]) =>
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.modes.join(' & ')}</Text>
  })

/** A session in a project whose roadmap the test can change; counts the reads and records fills, submits, opens and closes. */
const session = async (...[$, on, draft = '', language = 'Español']: [...Parameters<TestBody>, string?, string?]) => {
  const file = { exists: true, text: ROADMAP, mtimeMs: 1 }
  const seen = { reads: 0, stats: 0, filled: [] as { text: string; mode: string }[], submitted: [] as string[], refuse: false, opens: [] as string[], closes: [] as string[] }
  on('settings.read', () => ({ value: { language } }))
  on('session.root', () => ({ value: '/p' }))
  on('fs.exists', () => ({ value: file.exists }))
  on('fs.stat', () => {
    seen.stats++
    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', () => {
    seen.reads++
    return { value: file.text }
  })
  on('clock.now', () => ({ value: 0 }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', (_, e) => {
    seen.opens.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    seen.closes.push(e.id)
    return { value: undefined }
  })
  let box = draft
  on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
  on('prompt.fill', (_, e) => {
    box = e.text
    seen.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    seen.submitted.push(e.text)
    return seen.refuse ? { drop: 'busy' } : { text: e.text }
  })
  engineFooter(on)
  await $.session.start(START)
  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  return { file, seen, footer }
}

/** The same, with the pane opened from the footer button and mounted. */
const opened = async (...args: Parameters<typeof session>) => {
  const s = await session(...args)
  await s.footer.press({ key: 'roadmap-toggle' })
  const ui = await args[0].ui.mount({ ...PANE, surface: 'desktop' })
  return { ...s, ui }
}

test('a footer button beside the mode labels opens and closes the pane, and a closed pane reads nothing', async ($, on) => {
  const { seen, footer } = await session($, on)
  expect(await footer.find({ text: 'focus' })).toBeDefined()
  expect((await footer.find({ key: 'roadmap-toggle' }))?.text).toBe('Roadmap')
  expect(seen.reads).toBe(0)

  await footer.press({ key: 'roadmap-toggle' })
  expect(seen.opens).toEqual(['foreman-roadmap'])
  expect(seen.reads).toBe(1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ key: 'count-ready' }))?.text).toBe('1')
  await pane.unmount()

  await footer.press({ key: 'roadmap-toggle' })
  expect(seen.closes).toEqual(['foreman-roadmap'])
  await $.turn.complete(TURN)
  expect(seen.reads).toBe(1)
  await footer.unmount()
})

test('a project without a roadmap gets no button, no pane and no read; the mode labels stay', async ($, on) => {
  const { file, seen, footer } = await session($, on)
  await footer.unmount()
  file.exists = false
  await $.session.start(START)
  const bare = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await bare.find({ key: 'roadmap-toggle' })).toBeUndefined()
  expect(await bare.find({ text: 'focus' })).toBeDefined()
  await $.turn.complete(TURN)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  expect(seen.opens).toEqual([])
  expect(seen.stats).toBe(0)
  expect(seen.reads).toBe(0)
  await bare.unmount()
})

test('the button appears when a turn creates the roadmap', async ($, on) => {
  const { file, footer } = await session($, on)
  await footer.unmount()
  file.exists = false
  await $.session.start(START)
  const before = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await before.find({ key: 'roadmap-toggle' })).toBeUndefined()
  await before.unmount()
  file.exists = true
  await $.turn.complete(TURN)
  const after = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await after.find({ key: 'roadmap-toggle' })).toBeDefined()
  await after.unmount()
})

test('a session start forgets what an earlier session left in the state', async ($, on) => {
  const { footer, ui, seen } = await opened($, on)
  await ui.press({ key: '003' })
  await ui.press({ key: 'send-003' })
  await ui.input({ key: 'search', text: 'video', kind: 'change' })
  await ui.unmount()
  await footer.unmount()

  await $.session.start(START)
  const fresh = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  // Closed again, so the next press opens: it reads the file and lists everything, nothing marked sent.
  const reads = seen.reads
  await fresh.press({ key: 'roadmap-toggle' })
  expect(seen.reads).toBe(reads + 1)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await pane.find({ key: 'count-ready' }))?.text).toBe('1')
  expect(await pane.find({ text: /enviada/i })).toBeUndefined()
  expect(await pane.find({ key: 'card' })).toBeUndefined()
  expect(await pane.find({ key: '002' })).toBeDefined()
  await pane.unmount()
  await fresh.unmount()
})

test('the pane lists the roadmap on both surfaces, and its terminal rows are cut to the width', async ($, on) => {
  const { ui } = await opened($, on)
  await ui.unmount()
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ ...PANE, surface })
    expect(await pane.find({ type: 'Button', text: /Listas/ })).toBeDefined()
    // Every section head carries its name as well as its square.
    expect((await pane.find({ key: 'sec-ready' }))?.text).toBe('Listas ▾')
    expect((await pane.find({ key: 'count-ready' }))?.text).toBe('1')
    await pane.press({ key: 'sec-blocked' })
    expect(await pane.find({ key: '004' })).toBeDefined()
    await pane.press({ key: 'sec-blocked' })
    await pane.unmount()
  }
  const narrow = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE.props, bodyColumns: 16 } })
  await narrow.press({ key: 'sec-blocked' })
  expect((await narrow.find({ key: '004' }))?.text).toBe('004 Waits on…')
  expect((await narrow.find({ key: '003' }))?.text).toBe('003 Ready one')
  await narrow.unmount()
})

test('with no language set the pane speaks English', async ($, on) => {
  const { ui } = await opened($, on, '', '')
  expect((await ui.find({ key: 'sec-ready' }))?.text).toBe('Ready ▾')
  expect((await ui.find({ key: 'refresh' }))?.text).toBe('Refresh')
  await ui.press({ key: '003' })
  expect((await ui.find({ key: 'card-head' }))?.text).toBe('Task 003Close')
  expect((await ui.find({ key: 'card-made' }))?.text).toBe('CreatedNov 3 · You')
  expect((await ui.find({ key: 'card-met' }))?.text).toBe('Depends on001 (done)')
  expect((await ui.find({ key: 'send-003' }))?.text).toBe('Start')
  await ui.unmount()
})

test('sections collapse and expand; in progress and ready start open', async ($, on) => {
  const { ui } = await opened($, on)
  const head = async (id: string) => `${(await ui.find({ key: `sec-${id}` }))?.text} ${(await ui.find({ key: `count-${id}` }))?.text}`
  expect(await head('active')).toBe('En curso ▾ 2')
  expect(await head('ready')).toBe('Listas ▾ 1')
  expect(await head('blocked')).toBe('Bloqueadas ▸ 2')
  expect(await head('deferred')).toBe('Aplazadas ▸ 1')
  expect(await ui.find({ key: '004' })).toBeUndefined()
  expect(await ui.find({ text: /005 Parked/ })).toBeUndefined()

  await ui.press({ key: 'sec-deferred' })
  expect(await head('deferred')).toBe('Aplazadas ▾ 1')
  expect(await ui.find({ text: /005 Parked/ })).toBeDefined()

  await ui.press({ key: 'sec-ready' })
  expect(await head('ready')).toBe('Listas ▸ 1')
  expect(await ui.find({ key: '003' })).toBeUndefined()
  await ui.unmount()
})

test('the search field keeps the entries whose id, title or reason match, and Enter opens the first', async ($, on) => {
  const { ui } = await opened($, on)
  const ids = async () => (await ui.findAll({ type: 'Button' })).map(x => x.key ?? '').filter(k => /^\d+$/.test(k))

  await ui.input({ key: 'search', text: 'VÍDEO', kind: 'change' })
  expect(await ids()).toEqual(['002', '004'])
  expect((await ui.find({ key: 'sec-blocked' }))?.text).toBe('Bloqueadas')
  expect((await ui.find({ key: 'count-blocked' }))?.text).toBe('1')
  expect(await ui.find({ key: 'sec-ready' })).toBeUndefined()

  await ui.input({ key: 'search', text: 'because', kind: 'change' })
  expect(await ids()).toEqual(['003'])
  await ui.input({ key: 'search', text: '#006', kind: 'change' })
  expect(await ids()).toEqual(['006'])

  await ui.input({ key: 'search', text: 'nothing like it', kind: 'change' })
  expect(await ids()).toEqual([])
  expect((await ui.find({ key: 'no-hits' }))?.text).toBe('Ninguna tarea coincide con “nothing like it”.')

  // Enter opens the card of the first match, in the pane's order: blocked 006 before deferred 005.
  await ui.input({ key: 'search', text: 'parked' })
  expect((await ui.find({ key: 'card-head' }))?.text).toBe('Tarea 006Cerrar')

  await ui.input({ key: 'search', text: '', kind: 'change' })
  expect(await ids()).toEqual(['002', '007', '003'])
  expect((await ui.find({ key: 'sec-blocked' }))?.text).toBe('Bloqueadas ▸')
  await ui.unmount()
})

test('a section past 12 rows shows 12 and a press shows more, even two presses before a render', async ($, on) => {
  const many = Array.from({ length: 50 }, (_, i) => `{"id":"${100 + i}","title":"Task ${i}","status":"planned"}`)
  const { file, ui } = await opened($, on)
  file.text = many.join('\n')
  file.mtimeMs = 2
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: '111' })).toBeDefined()
  expect(await ui.find({ key: '112' })).toBeUndefined()
  expect((await ui.find({ key: 'more-ready' }))?.text).toBe('ver 12 más de 38')
  await Promise.all([ui.press({ key: 'more-ready' }), ui.press({ key: 'more-ready' })])
  expect(await ui.find({ key: '135' })).toBeDefined()
  expect(await ui.find({ key: '136' })).toBeUndefined()
  await ui.unmount()
})

test('To prompt keeps the draft as a hint and never submits; a draft that already starts with it stays', async ($, on) => {
  const start = EN.ask.pick('3')
  expect(draftWith(start, '')).toBe(start)
  expect(draftWith(start, 'only the auth part')).toBe(`${start} only the auth part`)
  expect(draftWith(start, `${EN.ask.resume('2')} only auth`)).toBe(`${start} only auth`)
  expect(draftWith(start, `${ES.ask.accept('2')} only auth`)).toBe(`${start} only auth`)
  expect(draftWith(start, start)).toBe(start)

  const { seen, ui } = await opened($, on, 'only the auth part', 'English')
  await ui.press({ key: '003' })
  expect(seen.filled).toEqual([])
  await ui.press({ key: 'fill-003' })
  // A second fill, for another entry, replaces the first request and keeps the hint.
  await ui.press({ key: '002' })
  await ui.press({ key: 'fill-002' })
  expect(seen.filled).toEqual([
    { text: 'Start roadmap entry 003 with Foreman. only the auth part', mode: 'replace' },
    { text: 'Resume roadmap entry 002 with Foreman. only the auth part', mode: 'replace' },
  ])
  expect(seen.submitted).toEqual([])
  await ui.unmount()
})

test('each card button asks Foreman in plain words, as the person, and marks the entry until its status changes', async ($, on) => {
  const { file, seen, ui } = await opened($, on, 'my draft', 'English')
  for (const [id, verb] of [['003', 'Start'], ['002', 'Resume'], ['007', 'Accept']] as const) {
    await ui.press({ key: id })
    expect((await ui.find({ key: `send-${id}` }))?.text).toBe(verb)
    await ui.press({ key: 'card-close' })
  }
  for (const id of ['003', '002', '007']) {
    await ui.press({ key: id })
    await ui.press({ key: `send-${id}` })
  }
  expect(seen.submitted).toEqual([
    'Start roadmap entry 003 with Foreman.',
    'Resume roadmap entry 002 with Foreman.',
    'Accept roadmap entry 007 with Foreman.',
  ])
  expect(seen.filled).toEqual([])
  expect(await ui.find({ text: /Sent · awaiting your acceptance/ })).toBeDefined()
  expect(await ui.find({ key: 'send-007' })).toBeUndefined()

  // Same file after the turn: still marked.
  await $.turn.complete(TURN)
  expect(await ui.find({ key: 'send-007' })).toBeUndefined()

  // Foreman starts 003: its mark goes and the row moves to in progress, with Resume on its card.
  file.text = ROADMAP.replace('"Ready one","status":"planned"', '"Ready one","status":"in_progress"')
  file.mtimeMs = 2
  await $.turn.complete(TURN)
  await ui.press({ key: '003' })
  expect((await ui.find({ key: 'send-003' }))?.text).toBe('Resume')
  await ui.unmount()
})

test('a prompt the engine refuses leaves the entry unmarked and its card button back', async ($, on) => {
  const { seen, ui } = await opened($, on)
  seen.refuse = true
  await ui.press({ key: '003' })
  await ui.press({ key: 'send-003' })
  expect(await ui.find({ text: /enviada/i })).toBeUndefined()
  expect(await ui.find({ key: 'send-003' })).toBeDefined()
  await ui.unmount()
})

test('a main-loop turn reads the file again; a subagent turn does not', async ($, on) => {
  const { seen, ui } = await opened($, on)
  expect(seen.reads).toBe(1)
  await $.turn.complete({ ...TURN, agentId: 'a1' })
  expect(seen.reads).toBe(1)
  await $.turn.complete(TURN)
  expect(seen.reads).toBe(2)
  await ui.unmount()
})

test('a shell call mid-turn reads the file again only when its mtime or size changed, and never from a subagent', async ($, on) => {
  const { file, seen, ui } = await opened($, on)
  expect(seen.reads).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'git status' })
  await $.tool.call({ tool: 'PowerShell', command: 'git status' })
  expect(seen.reads).toBe(1)

  file.text = ROADMAP.replace('"Ready one"', '"Ready now"')
  file.mtimeMs = 2
  await $.tool.call({ tool: 'Bash', command: 'node roadmap.js update-status', agentId: 'a1' })
  expect(seen.reads).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'node roadmap.js update-status' })
  expect(seen.reads).toBe(2)
  expect(await ui.find({ text: /003 Ready now/ })).toBeDefined()

  await ui.press({ key: 'refresh' })
  expect(seen.reads).toBe(3)
  await ui.unmount()
})

test('a roadmap deleted while the pane is open closes it quietly', async ($, on) => {
  const { file, seen, footer, ui } = await opened($, on)
  await ui.unmount()
  file.exists = false
  await $.turn.complete(TURN)
  expect(seen.closes).toEqual(['foreman-roadmap'])
  const bare = await $.ui.mount({ ...FOOTER, surface: 'desktop' })
  expect(await bare.find({ key: 'roadmap-toggle' })).toBeUndefined()
  await bare.unmount()
  await footer.unmount()
})

test('a roadmap over 4 MiB is not read, and the pane says what to do', async ($, on) => {
  const { file, seen, ui } = await opened($, on, '', 'English')
  file.text = ' '.repeat(4 * 1024 * 1024 + 1)
  file.mtimeMs = 2
  const reads = seen.reads
  await ui.press({ key: 'refresh' })
  expect(seen.reads).toBe(reads)
  expect(await ui.find({ text: /too large to show/ })).toBeDefined()
  await ui.unmount()
})

test('the card says the status, when and by whom, what the entry depends on and why', async ($, on) => {
  const { ui } = await opened($, on)
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.press({ key: '003' })
  const value = async (key: string) => (await ui.find({ key: `card-${key}` }))?.text
  expect(await value('head')).toBe('Tarea 003Cerrar')
  expect(await value('state')).toBe('Estado● Lista')
  expect(await value('made')).toBe('Creada3 nov · Tú')
  expect(await value('met')).toBe('Depende de001 (hecha)')
  expect(await ui.find({ key: 'card-files' })).toBeUndefined()
  expect(await ui.find({ text: 'Because it is ready.' })).toBeDefined()
  await ui.press({ key: 'sec-blocked' })
  await ui.press({ key: '004' })
  expect(await value('state')).toBe('Estado● Espera 002')
  expect(await ui.find({ key: 'card-met' })).toBeUndefined()
  // A blocked entry has nothing to send.
  expect(await ui.find({ key: 'send-004' })).toBeUndefined()
  await ui.press({ key: '004' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.press({ key: '007' })
  expect(await value('made')).toBe('Creada' + 'Sugerida')
  await ui.press({ key: 'card-close' })
  expect(await ui.find({ key: 'card' })).toBeUndefined()
  await ui.unmount()
})

test('a large roadmap shows the pending work and folds the deferred entries', async ($, on) => {
  const touches = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => `src/area/file-${i}.ts`))
  const lines = [
    `{"id":"1337","title":"Rigid bodies that turn: rotation, torque and box contacts in the baked simulation","status":"in_progress","planned_touches":${touches(7)}}`,
    `{"id":"1317","title":"Agents find the film's sound look before writing their own sound checks","status":"awaiting_acceptance","planned_touches":${touches(2)}}`,
    ...Array.from({ length: 8 }, (_, i) => `{"id":"${1371 + i}","title":"A planned task with a long enough title to need cutting","status":"planned","planned_touches":${touches(2)}}`),
    ...Array.from({ length: 5 }, (_, i) => `{"id":"${1273 + i}","title":"Waits on another","status":"planned","depends_on":["1337"]}`),
    ...Array.from({ length: 190 }, (_, i) => `{"id":"${i}","title":"Parked","status":"deferred"}`),
  ]
  const { file, ui } = await opened($, on)
  file.text = lines.join('\n')
  file.mtimeMs = 2
  await ui.press({ key: 'refresh' })
  // 190 deferred entries stay folded and the planned ones show: ten rows, no file lines.
  const entries = (await ui.findAll({ type: 'Button' })).filter(x => /^\d+$/.test(x.key ?? '')).length
  const files = (await ui.findAll({ type: 'Text', text: /^src\/area\// })).length
  expect(entries).toBe(10)
  expect(files).toBe(0)
  expect(await ui.find({ key: '1378' })).toBeDefined()
  await ui.unmount()
})

test('the card lists up to three planned files, the folder after the name, and counts the rest', async ($, on) => {
  const { file, ui } = await opened($, on, '', 'English')
  file.text = '{"id":"9","title":"Many files","status":"planned","planned_touches":["src/a.ts","src/b/","c.md","d.md","e.md"]}'
  file.mtimeMs = 2
  await ui.press({ key: 'refresh' })
  await ui.press({ key: '9' })
  expect((await ui.find({ key: 'card-files' }))?.text).toBe('Files5')
  expect((await ui.find({ key: 'card-file-src/a.ts' }))?.text).toBe('a.ts · src')
  expect((await ui.find({ key: 'card-file-src/b/' }))?.text).toBe('b/ · src')
  expect((await ui.find({ key: 'card-file-c.md' }))?.text).toBe('c.md')
  expect(await ui.find({ key: 'card-file-d.md' })).toBeUndefined()
  expect((await ui.find({ key: 'card-file-more' }))?.text).toBe('and 2 more')
  await ui.unmount()
})
