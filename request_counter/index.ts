import type { Plugin } from "@opencode-ai/plugin"

interface SessionData {
  requests: number
  errors: number
  busy: boolean
  baseTitle: string
}

const sessions = new Map<string, SessionData>()
const myUpdates = new Set<string>()
let pendingUpdate: ReturnType<typeof setTimeout> | null = null

function stripPrefix(title: string): string {
  return title.replace(/^\[Req \d+ Err \d+\]\s*/, "")
}

export const RequestCounter: Plugin = async (ctx) => {
  function scheduleUpdate(sessionID: string): void {
    if (pendingUpdate) clearTimeout(pendingUpdate)
    pendingUpdate = setTimeout(() => {
      pendingUpdate = null
      const s = sessions.get(sessionID)
      if (!s) return
      myUpdates.add(sessionID)
      const title = `[Req ${s.requests} Err ${s.errors}] ${s.baseTitle}`
      ctx.client.session.update({ path: { id: sessionID }, body: { title } }).catch(() => {
        myUpdates.delete(sessionID)
      })
    }, 300)
  }

  function ensureSession(sessionID: string): SessionData {
    let s = sessions.get(sessionID)
    if (!s) {
      s = { requests: 0, errors: 0, busy: false, baseTitle: "" }
      sessions.set(sessionID, s)
    }
    return s
  }

  return {
    event: async ({ event }) => {
      if (event.type === "session.created") {
        const { id, title } = event.properties.info
        const s = ensureSession(id)
        s.baseTitle = stripPrefix(title)
        scheduleUpdate(id)
      }

      if (event.type === "session.updated") {
        const { id, title } = event.properties.info
        if (myUpdates.has(id)) {
          myUpdates.delete(id)
          return
        }
        const s = ensureSession(id)
        s.baseTitle = stripPrefix(title)
      }

      if (event.type === "session.deleted") {
        sessions.delete(event.properties.info.id)
      }

      if (event.type === "session.status") {
        const { sessionID, status } = event.properties
        const s = ensureSession(sessionID)
        if (status.type === "busy" && !s.busy) {
          s.requests++
          s.busy = true
          scheduleUpdate(sessionID)
        } else if (status.type === "idle") {
          s.busy = false
        }
      }

      if (event.type === "session.error") {
        const sessionID = event.properties.sessionID
        if (sessionID) {
          const s = ensureSession(sessionID)
          s.errors++
          scheduleUpdate(sessionID)
        }
      }
    },
  }
}
