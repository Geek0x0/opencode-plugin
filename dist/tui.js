import { watch } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { createElement, insert, setProp } from "@opentui/solid"
import { createSignal } from "solid-js"

const PLUGIN_ID = "llm-stats-sidebar:tui"
const POLL_INTERVAL_MS = 2000
const SLOT_ORDER = 860
const WIDTH = 34

function element(tag, props, children = []) {
  const node = createElement(tag)
  for (const [key, value] of Object.entries(props || {})) {
    if (value !== undefined) setProp(node, key, value)
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) insert(node, child)
  }
  return node
}

function text(props, children) {
  return element("text", props, children)
}

function box(props, children = []) {
  return element("box", props, children)
}

function renderText(value, color) {
  return text({ fg: color }, [truncate(String(value), WIDTH)])
}

function renderLine(label, value, theme) {
  const left = `${label}:`
  const right = String(value)
  const gap = Math.max(1, WIDTH - left.length - right.length)
  return renderText(`${left}${" ".repeat(gap)}${right}`, theme.text)
}

function renderMuted(value, theme) {
  return renderText(value, theme.textMuted ?? theme.text)
}

function renderPanel(children) {
  return box(
    {
      width: "100%",
      flexDirection: "column",
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
    },
    children,
  )
}

function renderSidebar(state, statePath, collapsed, toggleCollapsed, theme) {
  const marker = collapsed ? "[+]" : "[-]"
  const title = `${marker} LLM Requests (${formatInt(state.totalRequests || 0)})`
  const header = box({ width: "100%", onMouseDown: toggleCollapsed }, [
    renderText(title, theme.accent ?? theme.text),
  ])

  if (collapsed) return renderPanel([header])

  const topModel = Object.entries(state.byModel || {})
    .sort((a, b) => (b[1].requests || 0) - (a[1].requests || 0))
    .at(0)

  const lines = [
    header,
    renderLine("active", formatInt((state.activeSessions || []).length), theme),
    renderLine("errors", formatInt(state.errors || 0), theme),
    renderLine("in tok", formatInt(state.inputTokens || 0), theme),
    renderLine("out tok", formatInt(state.outputTokens || 0), theme),
    renderLine("total", formatInt(state.totalTokens || 0), theme),
    renderLine("cost", formatCost(state.totalCost || 0), theme),
    renderMuted("", theme),
    renderMuted("top model", theme),
    renderMuted(topModel ? `${topModel[0]} (${topModel[1].requests || 0})` : "none yet", theme),
    renderMuted("", theme),
    renderMuted("recent", theme),
    ...renderRecent(state.recent || [], theme),
    renderMuted("", theme),
    renderMuted(shortPath(statePath), theme),
  ]

  return renderPanel(lines)
}

function renderRecent(recent, theme) {
  if (recent.length === 0) return [renderMuted("no requests yet", theme)]

  return recent.slice(0, 4).map((item) => {
    const model = item.model || "unknown"
    const tokens = formatInt(item.tokens || 0)
    return renderMuted(`${formatTime(item.time)} ${model} ${tokens}`, theme)
  })
}

async function loadState(statePath) {
  const fallback = {
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    errors: 0,
    activeSessions: [],
    byModel: {},
    recent: [],
  }

  try {
    const text = await readFile(statePath, "utf8")
    return { ...fallback, ...JSON.parse(text) }
  } catch {
    return fallback
  }
}

function resolveStatePath() {
  const root =
    process.env.OPENCODE_WORKTREE ||
    process.env.OPENCODE_DIRECTORY ||
    process.env.PWD ||
    process.cwd()
  return path.join(root, ".opencode", "llm-request-stats.json")
}

function registerWatcher(statePath, reload) {
  const timers = []
  const watchers = []

  timers.push(setInterval(reload, POLL_INTERVAL_MS))

  try {
    watchers.push(
      watch(path.dirname(statePath), { persistent: false }, (_event, filename) => {
        if (!filename || String(filename) === path.basename(statePath)) reload()
      }),
    )
  } catch {
    // Polling still keeps the sidebar fresh if the directory does not exist yet.
  }

  return () => {
    for (const timer of timers) clearInterval(timer)
    for (const watcher of watchers) watcher.close()
  }
}

function truncate(value, width) {
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, width)
  return `${value.slice(0, width - 1)}.`
}

function shortPath(value) {
  const marker = ".opencode/"
  const index = value.lastIndexOf(marker)
  return index >= 0 ? value.slice(index) : value
}

function formatInt(value) {
  return Math.round(Number(value || 0)).toLocaleString()
}

function formatCost(value) {
  const cost = Number(value || 0)
  if (!cost) return "$0.0000"
  if (cost < 0.01) return `$${cost.toFixed(5)}`
  return `$${cost.toFixed(3)}`
}

function formatTime(value) {
  if (!value) return "--:--"
  return new Date(value).toLocaleTimeString()
}

const plugin = {
  id: PLUGIN_ID,
  tui: async (api) => {
    const statePath = resolveStatePath()
    const [getState, setState] = createSignal(await loadState(statePath))
    const [isCollapsed, setCollapsed] = createSignal(false)

    const requestRender = () => api.renderer.requestRender()
    const reload = () => {
      void loadState(statePath).then((next) => {
        setState(next)
        requestRender()
      })
    }

    const disposeWatcher = registerWatcher(statePath, reload)

    api.lifecycle.onDispose(() => {
      disposeWatcher()
    })

    api.slots.register({
      order: SLOT_ORDER,
      slots: {
        sidebar_content: () => {
          try {
            const theme = api.theme.current || {}
            return renderSidebar(
              getState(),
              statePath,
              isCollapsed(),
              () => {
                setCollapsed(!isCollapsed())
                requestRender()
              },
              theme,
            )
          } catch (error) {
            const theme = api.theme.current || {}
            return box({ width: "100%" }, [
              text({ fg: theme.error ?? theme.text }, [`llm-stats render error: ${String(error).slice(0, 60)}`]),
            ])
          }
        },
      },
    })
  },
}

export default plugin
