import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Actor, ActorKind, ActorStatus, TimelineEvent } from '../types'

const PANE = 'ekip'
const STALE_MS = 6 * 60 * 60 * 1000
let poller: { cancel: () => void } | undefined

// Change a tag when that value's fields change: it declines what an earlier version stored.
const actors = atom({ plugin: 'ekip-renkleri', key: 'actors' } as const, [], { shape: 'actors-2' })
const timeline = atom({ plugin: 'ekip-renkleri', key: 'timeline' } as const, [], { shape: 'timeline-2' })

// A Codex run is a command that runs it (node ...codex.mjs, codex(.exe) exec), not one that merely names the file.
const CODEX = /(^|[;&|(]\s*)(node(\.exe)?\s+\S*codex\.mjs\b|\S*codex(\.exe)?["']?\s+exec\b)/i
const BACKGROUND_ID = /background with ID:\s*([A-Za-z0-9_-]+)/
const OUTPUT_FILE = /Output is being written to:\s*(.+?\.output)/
const EXIT_LINE = /\[exited with code (-?\d+)\]\s*$/
const TASK_NOTICE = /<task-id>([A-Za-z0-9_-]+)<\/task-id>[\s\S]*?<status>([a-z]+)<\/status>/g

/** One colour per kind of worker; subagents by model family. */
function colorOf(actor: Pick<Actor, 'kind' | 'model'>): string {
  if (actor.kind === 'claude') return '#D97757'
  if (actor.kind === 'codex') return '#14B8A6'
  const model = actor.model.toLowerCase()
  if (model.includes('opus')) return '#8B6CEF'
  if (model.includes('sonnet')) return '#3B82F6'
  if (model.includes('haiku')) return '#65A30D'
  if (model.includes('fable')) return '#E0A100'
  return '#64748B'
}

function kindLabel(actor: Actor): string {
  if (actor.kind === 'claude') return 'Claude'
  if (actor.kind === 'codex') return 'Codex'
  return modelName(actor.model)
}

function modelName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('opus')) return 'Opus'
  if (m.includes('sonnet')) return 'Sonnet'
  if (m.includes('haiku')) return 'Haiku'
  if (m.includes('fable')) return 'Fable'
  return model || 'Alt ajan'
}

/** A tiny matte keycap with two eyes: the Thock family, tinted per worker. */
function keycapSvg(color: string, status: ActorStatus): string {
  const eyes =
    status === 'done'
      ? '<rect x="6.2" y="8.6" width="2.4" height="1.1" rx=".55" fill="#fff"/><rect x="11.4" y="8.6" width="2.4" height="1.1" rx=".55" fill="#fff"/>'
      : status === 'failed'
        ? '<path d="M6.4 7.6l2 2M8.4 7.6l-2 2M11.6 7.6l2 2M13.6 7.6l-2 2" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/>'
        : '<rect x="6.9" y="6.9" width="1.4" height="3.4" rx=".7" fill="#fff"/><rect x="11.7" y="6.9" width="1.4" height="3.4" rx=".7" fill="#fff"/>'
  const opacity = status === 'done' ? '0.55' : '1'
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" opacity="${opacity}">` +
    `<rect x="1.5" y="3" width="17" height="15" rx="4" fill="${color}"/>` +
    '<rect x="1.5" y="3" width="17" height="15" rx="4" fill="#000" fill-opacity=".28"/>' +
    `<rect x="3" y="2" width="14" height="12" rx="3.4" fill="${color}"/>` +
    '<rect x="3" y="2" width="14" height="5" rx="2.5" fill="#fff" fill-opacity=".14"/>' +
    eyes +
    '</svg>'
  )
}

function statusWord(status: ActorStatus): string {
  if (status === 'running') return 'çalışıyor'
  if (status === 'waiting') return 'arka planda'
  if (status === 'failed') return 'hata'
  return 'bitti'
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function since(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} sn`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m} dk` : `${Math.floor(m / 60)} sa ${m % 60} dk`
}

async function upsert($: Engine, id: string, fn: (a: Actor | undefined) => Actor) {
  await update($, actors, list => {
    const found = list.find(a => a.id === id)
    const fresh = fn(found)
    const all = [...list.filter(a => a.id !== id), fresh]
    // Claude stays first; of the workers, keep the newest 39 by start.
    const claude = all.filter(a => a.id === 'claude')
    const workers = all.filter(a => a.id !== 'claude').sort((a, b) => a.startedAt - b.startedAt).slice(-39)
    return [...claude, ...workers]
  })
}

/** Changes a worker that is still listed (and, with `onlyIf`, still in that state); otherwise nothing. */
async function patch($: Engine, id: string, fields: Partial<Actor>, onlyIf?: ActorStatus): Promise<boolean> {
  let changed = false
  await update($, actors, list =>
    list.map(a => {
      if (a.id !== id || (onlyIf && a.status !== onlyIf)) return a
      changed = true
      return { ...a, ...fields }
    }),
  )
  return changed
}

async function log($: Engine, actorId: string, text: string) {
  const at = await $.clock.now()
  const actor = (await read($, actors)).find(a => a.id === actorId)
  const entry: TimelineEvent = {
    at,
    actorId,
    kind: actor?.kind ?? (actorId === 'claude' ? 'claude' : actorId.startsWith('codex:') ? 'codex' : 'subagent'),
    model: actor?.model ?? (actorId.startsWith('codex:') ? 'codex' : ''),
    text: clip(text, 90),
  }
  await update($, timeline, list => [...list, entry].slice(-120))
}

async function refreshStatus($: Engine) {
  const list = await read($, actors)
  const live = list.filter(a => a.status === 'running' || a.status === 'waiting')
  const subs = live.filter(a => a.kind === 'subagent').length
  const codex = live.filter(a => a.kind === 'codex').length
  const parts: string[] = []
  if (live.some(a => a.kind === 'claude')) parts.push('Claude')
  if (subs) parts.push(`${subs} alt ajan`)
  if (codex) parts.push(codex === 1 ? 'Codex' : `${codex} Codex`)
  $.ui.status(subs || codex ? `Ekip: ${parts.join(' · ')}` : undefined)
}

async function ensureClaude($: Engine, status: ActorStatus) {
  const now = await $.clock.now()
  await upsert($, 'claude', a => ({
    id: 'claude',
    kind: 'claude' as ActorKind,
    label: 'Claude',
    model: 'main',
    status,
    startedAt: a?.startedAt ?? now,
    endedAt: status === 'done' ? now : null,
    tools: a?.tools ?? 0,
    last: a?.last ?? '',
    taskId: null,
    outputFile: null,
  }))
}

/** A Codex run in the background finishes when its notice wakes the main loop. */
async function closeNotices($: Engine, text: string) {
  if (!text.includes('<task-id>')) return
  const now = await $.clock.now()
  const list = await read($, actors)
  for (const match of text.matchAll(TASK_NOTICE)) {
    const taskId = match[1]
    const status = match[2] ?? ''
    const actor = list.find(a => a.taskId === taskId && a.status === 'waiting')
    if (!actor) continue
    const failed = status !== 'completed'
    if (await patch($, actor.id, { status: failed ? 'failed' : 'done', endedAt: now }, 'waiting')) {
      await log($, actor.id, failed ? `durdu (${status})` : 'bitti')
    }
  }
}

/** Background Codex runs end when their output file gets the shell's exit line. */
async function pollBackground($: Engine) {
  const list = await read($, actors)
  const waiting = list.filter(a => a.status === 'waiting' && a.outputFile)
  if (waiting.length === 0) return
  const now = await $.clock.now()
  for (const actor of waiting) {
    let tail = ''
    try {
      const text = await $.fs.read(actor.outputFile as string)
      tail = typeof text === 'string' ? text.slice(-400) : ''
    } catch {
      tail = ''
    }
    const exit = tail.match(EXIT_LINE)
    if (exit) {
      const code = Number(exit[1])
      const ok = await patch($, actor.id, { status: code === 0 ? 'done' : 'failed', endedAt: now }, 'waiting')
      if (ok) await log($, actor.id, code === 0 ? `bitti (${since(now - actor.startedAt)})` : `hata ile bitti (kod ${code})`)
    } else if (now - actor.startedAt > STALE_MS) {
      // Stopped from outside, or its output is gone: say so instead of waiting forever.
      const ok = await patch($, actor.id, { status: 'failed', endedAt: now }, 'waiting')
      if (ok) await log($, actor.id, 'sonucu bilinmiyor (6 saattir kapanmadı)')
    }
  }
  await refreshStatus($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'ekip', description: 'Oturumda çalışan Claude, alt ajan ve Codex listesini aç' })
    void $.ui.open({ id: PANE, title: 'Ekip' })
    poller?.cancel()
    poller = $.clock.every(5000, async () => {
      try {
        await pollBackground($)
      } catch {
        // A failed poll waits for the next tick.
      }
      // Elapsed times move on their own: redraw the pane and band.
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('command.run', { command: 'ekip' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Ekip' })
    return { text: 'Ekip paneli açıldı.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await ensureClaude($, 'running')
      await closeNotices($, e.text)
      await refreshStatus($)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      await ensureClaude($, 'done')
    } else {
      const id = e.agentId
      const list = await read($, actors)
      if (list.some(a => a.id === id)) {
        await patch($, id, { status: e.isAborted ? 'failed' : 'done', endedAt: now })
        await log($, id, e.isAborted ? 'durduruldu' : `bitti (${since(e.durationMs)})`)
      }
    }
    await refreshStatus($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.agentId) {
      const id = ran.agentId
      const now = await $.clock.now()
      const model = ran.model || e.model || ''
      await upsert($, id, () => ({
        id,
        kind: 'subagent',
        label: clip(e.description || e.subagentType || 'Alt ajan', 40),
        model,
        status: 'running',
        startedAt: now,
        endedAt: null,
        tools: 0,
        last: '',
        taskId: null,
        outputFile: null,
      }))
      await log($, id, `başladı: ${e.description || e.subagentType}`)
      await refreshStatus($)
    }
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const owner = e.agentId ?? 'claude'
    const isCodex = e.tool === 'Bash' && CODEX.test(e.command)
    const what = e.tool === 'Bash' ? (e.description || clip(e.command, 50)) : e.tool

    if (owner === 'claude') await ensureClaude($, 'running')
    const list = await read($, actors)
    if (list.some(a => a.id === owner)) {
      const prev = list.find(a => a.id === owner)
      await patch($, owner, { tools: (prev?.tools ?? 0) + 1, last: clip(what, 60) })
    }

    if (!isCodex || e.tool !== 'Bash') return next(e)

    // A Codex run: its own worker, coloured apart from whoever started it.
    const codexId = `codex:${e.tool_use_id ?? (await $.clock.now())}`
    const started = await $.clock.now()
    const label = clip(e.description || 'Codex görevi', 40)
    await upsert($, codexId, () => ({
      id: codexId,
      kind: 'codex',
      label,
      model: 'codex',
      status: 'running',
      startedAt: started,
      endedAt: null,
      tools: 0,
      last: '',
      taskId: null,
      outputFile: null,
    }))
    await log($, codexId, `başladı: ${label}`)
    await refreshStatus($)

    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (error) {
      await patch($, codexId, { status: 'failed', endedAt: await $.clock.now() })
      await log($, codexId, 'yarıda kaldı')
      await refreshStatus($)
      throw error
    }
    const text = 'text' in ran && typeof ran.text === 'string' ? ran.text : ''
    const bg = text.match(BACKGROUND_ID)
    const now = await $.clock.now()
    if (ran.deny !== undefined) {
      await patch($, codexId, { status: 'failed', endedAt: now })
      await log($, codexId, 'reddedildi')
    } else if (bg) {
      const out = text.match(OUTPUT_FILE)?.[1]?.trim() ?? null
      await patch($, codexId, { status: 'waiting', taskId: bg[1] ?? null, outputFile: out })
      await log($, codexId, 'arka planda sürüyor')
    } else {
      const failed = 'isError' in ran && ran.isError === true
      await patch($, codexId, { status: failed ? 'failed' : 'done', endedAt: now })
      await log($, codexId, failed ? 'hata ile bitti' : `bitti (${since(now - started)})`)
    }
    await refreshStatus($)
    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, actors)
    const live = list.filter(a => a.kind !== 'claude' && (a.status === 'running' || a.status === 'waiting'))
    if (e.props.hasSurvey || live.length === 0) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    return (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text dimColor>Çalışıyor:</Text>
        {live.slice(0, 6).map(a => (
          <Box flexDirection="row" gap={1}>
            {Svg ? (
              <Svg source={keycapSvg(colorOf(a), a.status)} alt={kindLabel(a)} width={16} height={16} />
            ) : (
              <Text backgroundColor={colorOf(a)} color="#ffffff"> ▮▮ </Text>
            )}
            <Text color={colorOf(a)} bold>{kindLabel(a)}</Text>
            <Text dimColor>{clip(a.label, 24)}</Text>
          </Box>
        ))}
        {live.length > 6 && <Text dimColor>+{live.length - 6}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const list = await read($, actors)
    const events = await read($, timeline)
    const now = await $.clock.now()
    const byId = new Map(list.map(a => [a.id, a]))
    const live = list.filter(a => a.status === 'running' || a.status === 'waiting')
    const done = list.filter(a => a.status === 'done' || a.status === 'failed').slice(-12).reverse()
    const room = Math.max(4, (e.viewport?.rows ?? 30) - live.length - done.length - 10)

    const avatar = (a: Actor, size: number) =>
      Svg ? (
        <Svg source={keycapSvg(colorOf(a), a.status)} alt={`${kindLabel(a)} ${statusWord(a.status)}`} width={size} height={size} />
      ) : (
        <Text backgroundColor={colorOf(a)} color="#ffffff">{a.status === 'done' ? ' -- ' : ' ▮▮ '}</Text>
      )

    const row = (a: Actor) => (
      <Box flexDirection="row" gap={1}>
        {avatar(a, 20)}
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text color={colorOf(a)} bold>{kindLabel(a)}</Text>
            <Text>{a.kind === 'claude' ? 'ana oturum' : a.label}</Text>
          </Box>
          <Text dimColor>
            {statusWord(a.status)} · {since((a.endedAt ?? now) - a.startedAt)}
            {a.tools ? ` · ${a.tools} araç` : ''}
            {a.last && (a.status === 'running' || a.status === 'waiting') ? ` · ${a.last}` : ''}
          </Text>
        </Box>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {[
            { kind: 'claude', model: 'main', name: 'Claude' },
            { kind: 'subagent', model: 'opus', name: 'Opus' },
            { kind: 'subagent', model: 'sonnet', name: 'Sonnet' },
            { kind: 'subagent', model: 'haiku', name: 'Haiku' },
            { kind: 'codex', model: 'codex', name: 'Codex' },
          ].map(k => (
            <Text color={colorOf({ kind: k.kind as ActorKind, model: k.model })}>■ {k.name}</Text>
          ))}
        </Box>

        <Text bold>Şimdi</Text>
        {live.length === 0 ? <Text dimColor>Şu an kimse çalışmıyor.</Text> : live.map(row)}

        {done.length > 0 && <Text bold>Bitenler</Text>}
        {done.map(row)}

        <Text bold>Akış</Text>
        {events.length === 0 && <Text dimColor>Henüz bir şey olmadı.</Text>}
        {events.slice(-room).map(ev => {
          const a = byId.get(ev.actorId)
          const who = a ?? { kind: ev.kind, model: ev.model }
          const name = who.kind === 'claude' ? 'Claude' : who.kind === 'codex' ? 'Codex' : modelName(who.model)
          return (
            <Box flexDirection="row" gap={1}>
              <Text dimColor>{since(now - ev.at)}</Text>
              <Text color={colorOf(who)} bold>{name}</Text>
              <Text>{ev.text}</Text>
            </Box>
          )
        })}

        <Button
          key="temizle"
          label="Bitenleri temizle"
          onPress={async () => {
            await update($, actors, all => all.filter(a => a.status === 'running' || a.status === 'waiting' || a.id === 'claude'))
            await update($, timeline, () => [])
          }}
        />
      </Box>
    )
  })
}
