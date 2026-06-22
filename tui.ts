import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createElement, insert, setProp } from "@opentui/solid"
import { createSignal } from "solid-js"

interface SessionCounts {
  requests: number
  errors: number
  lastStatus: string
  busy: boolean
}

const sessions = new Map<string, SessionCounts>()

function el(tag: string, props: Record<string, unknown>, children: any[] = []): any {
  const node = createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value)
  }
  for (const child of children) {
    if (child != null && child !== false) insert(node, child)
  }
  return node
}

function txt(fg: any, content: string): any {
  return el("text", { fg }, [content])
}

const plugin: TuiPluginModule = {
  id: "request-counter:tui",
  tui: async (api) => {
    let currentSessionID: string | null = null
    const [getCounts, setCounts] = createSignal({ requests: 0, errors: 0, lastStatus: "idle" as string })
    const theme = () => api.theme.current
    const render = () => api.renderer.requestRender()

    function updateDisplay(sessionID: string): void {
      currentSessionID = sessionID
      const s = sessions.get(sessionID)
      if (s) {
        setCounts({ requests: s.requests, errors: s.errors, lastStatus: s.lastStatus })
        render()
      }
    }

    const unsubBusy = api.event.on("session.status", (event) => {
      const { sessionID, status } = event.properties
      let s = sessions.get(sessionID)
      if (!s) {
        s = { requests: 0, errors: 0, lastStatus: "idle", busy: false }
        sessions.set(sessionID, s)
      }
      if (status.type === "busy" && !s.busy) {
        s.requests++
        s.busy = true
        s.lastStatus = "busy"
      } else if (status.type === "idle") {
        s.busy = false
        s.lastStatus = "idle"
      }
      updateDisplay(sessionID)
    })

    const unsubError = api.event.on("session.error", (event) => {
      const sessionID = event.properties.sessionID
      if (sessionID) {
        let s = sessions.get(sessionID)
        if (!s) {
          s = { requests: 0, errors: 0, lastStatus: "idle", busy: false }
          sessions.set(sessionID, s)
        }
        s.errors++
        s.lastStatus = "error"
        updateDisplay(sessionID)
      }
    })

    const unsubCreated = api.event.on("session.created", (event) => {
      const id = event.properties.info.id
      sessions.set(id, { requests: 0, errors: 0, lastStatus: "idle", busy: false })
      updateDisplay(id)
    })

    const unsubDeleted = api.event.on("session.deleted", (event) => {
      const id = event.properties.info.id
      sessions.delete(id)
      if (currentSessionID === id) currentSessionID = null
    })

    api.lifecycle.onDispose(() => {
      unsubBusy()
      unsubError()
      unsubCreated()
      unsubDeleted()
    })

    api.slots.register({
      order: 200,
      slots: {
        sidebar_content: () => {
          const c = getCounts()
          const t = theme()
          const busy = c.lastStatus === "busy"
          return el("box", { width: "100%", flexDirection: "column" }, [
            el("box", { width: "100%", flexDirection: "column", paddingLeft: 1, paddingTop: 0 }, [
              txt(t.text, busy ? "⟳ LLM Request" : "● LLM Request"),
              el("box", { width: "100%", flexDirection: "column", paddingLeft: 1 }, [
                txt(t.text, `  Sent: ${c.requests}`),
                txt(c.errors > 0 ? t.error : t.text, `  Errors: ${c.errors}`),
              ]),
            ]),
          ])
        },
      },
    } as any)
  },
}

export default plugin
