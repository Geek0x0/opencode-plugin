import { createElement, insert, setProp } from "@opentui/solid"
import { createSignal } from "solid-js"

const PLUGIN_ID = "llm-call-count-sidebar:tui"
const SLOT_ORDER = 860
const WIDTH = 28

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

function renderSidebar(count, status, theme) {
  return renderPanel([
    renderText(`LLM Calls: ${formatInt(count)}`, theme.accent ?? theme.text),
    status ? renderText(status, theme.textMuted ?? theme.text) : null,
  ])
}

function normalizeEvent(input) {
  if (!input) return undefined
  if (input.event) return input.event
  return input
}

function eventPayload(event) {
  return event?.properties || event?.data || event?.payload || event
}

function countKey(event) {
  const type = event?.type || ""
  const payload = eventPayload(event)

  if (type === "message.part.updated") {
    const part = payload?.part || payload
    if (!part || typeof part !== "object") return ""

    const looksLikeFinish =
      part.type === "step-finish" ||
      part.type === "step.finish" ||
      part.type === "finish" ||
      Boolean(part.usage)

    if (!looksLikeFinish) return ""
    return stringKey(part.sessionID, part.messageID, part.id)
  }

  if (type === "message.updated") {
    const message = payload?.info || payload?.message || payload
    const role = message?.role || message?.type || message?.info?.role || message?.info?.type
    if (role !== "assistant") return ""

    return stringKey(
      message?.sessionID || message?.info?.sessionID || payload?.sessionID,
      message?.id || message?.messageID || message?.info?.id || message?.info?.messageID,
      "",
    )
  }

  return ""
}

function stringKey(sessionID, messageID, fallbackID) {
  const session = typeof sessionID === "string" ? sessionID : "session"
  const message = typeof messageID === "string" ? messageID : ""
  const fallback = typeof fallbackID === "string" ? fallbackID : ""
  if (!message && !fallback) return ""
  return `${session}:${message || fallback}`
}

function subscribeToEvents(api, onEvent) {
  const unsubscribers = []
  const directCandidates = [
    api?.event?.subscribe,
    api?.events?.subscribe,
    api?.bus?.subscribe,
    api?.tui?.events?.subscribe,
  ].filter((candidate) => typeof candidate === "function")

  for (const subscribe of directCandidates) {
    const unsubscribe = trySubscribe(subscribe, onEvent)
    if (unsubscribe) unsubscribers.push(unsubscribe)
  }

  const clientSubscribe = api?.client?.event?.subscribe
  if (typeof clientSubscribe === "function") {
    const unsubscribe = trySubscribe(clientSubscribe, onEvent)
    if (unsubscribe) unsubscribers.push(unsubscribe)
  }

  if (unsubscribers.length === 0) return undefined
  return () => {
    for (const unsubscribe of unsubscribers) {
      try {
        unsubscribe()
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

function trySubscribe(subscribe, onEvent) {
  const callback = (input) => onEvent(normalizeEvent(input))

  try {
    return normalizeUnsubscribe(subscribe(callback))
  } catch {
    // Some APIs use an options object.
  }

  try {
    return normalizeUnsubscribe(subscribe({ event: callback, onEvent: callback, callback }))
  } catch {
    return undefined
  }
}

function normalizeUnsubscribe(result) {
  if (typeof result === "function") return result
  if (result && typeof result.unsubscribe === "function") return () => result.unsubscribe()
  if (result && typeof result.dispose === "function") return () => result.dispose()
  if (result && typeof result.close === "function") return () => result.close()
  return undefined
}

function truncate(value, width) {
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, width)
  return `${value.slice(0, width - 1)}.`
}

function formatInt(value) {
  return Math.round(Number(value || 0)).toLocaleString()
}

const plugin = {
  id: PLUGIN_ID,
  tui: async (api) => {
    const seen = new Set()
    const [getCount, setCount] = createSignal(0)
    const [getStatus, setStatus] = createSignal("")
    const requestRender = () => api.renderer.requestRender()

    const unsubscribe = subscribeToEvents(api, (event) => {
      const key = countKey(event)
      if (!key || seen.has(key)) return

      seen.add(key)
      setCount(getCount() + 1)
      setStatus("")
      requestRender()
    })

    if (!unsubscribe) {
      setStatus("event api unavailable")
    }

    api.lifecycle.onDispose(() => {
      if (unsubscribe) unsubscribe()
    })

    api.slots.register({
      order: SLOT_ORDER,
      slots: {
        sidebar_content: () => {
          try {
            const theme = api.theme.current || {}
            return renderSidebar(getCount(), getStatus(), theme)
          } catch (error) {
            const theme = api.theme.current || {}
            return box({ width: "100%" }, [
              text({ fg: theme.error ?? theme.text }, [`llm-count render error: ${String(error).slice(0, 60)}`]),
            ])
          }
        },
      },
    })
  },
}

export default plugin

