import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"

const PLUGIN_ID = "llm-stats-sidebar"
const PLUGIN_NAME = "llm-stats-sidebar"
const MAX_RECENT = 8

const numberKeys = {
  input: [
    "inputTokens",
    "promptTokens",
    "prompt_tokens",
    "input_tokens",
    "input",
    "prompt",
    "tokensIn",
    "tokens_in",
  ],
  output: [
    "outputTokens",
    "completionTokens",
    "completion_tokens",
    "output_tokens",
    "output",
    "completion",
    "tokensOut",
    "tokens_out",
  ],
  total: ["totalTokens", "total_tokens", "tokens", "total"],
  cost: ["cost", "totalCost", "total_cost", "price", "amount"],
}

async function server(ctx) {
  const root = ctx.directory || ctx.worktree || process.cwd()
  const statePath = path.join(root, ".opencode", "llm-request-stats.json")

  const state = await loadState(statePath)
  const activeSessions = new Set(state.activeSessions || [])
  const countedRequests = new Set(state.countedRequests || [])
  const countedMessages = new Set(state.countedMessages || [])

  let saveTimer

  await log(ctx.client, "info", "LLM stats sidebar server initialized", { statePath })

  return {
    tool: {
      llm_request_stats: tool({
        description: "Show LLM request statistics collected by the local OpenCode stats plugin.",
        args: {},
        async execute() {
          return renderStats(state, activeSessions, statePath)
        },
      }),
    },

    event: async ({ event }) => {
      handleEvent(event)
      scheduleSave()
    },
  }

  function handleEvent(event) {
    if (!event || typeof event !== "object") return

    const type = event.type || ""
    const payload = event.properties || event

    if (type === "session.status") {
      handleSessionStatus(payload)
      return
    }

    if (type === "session.idle") {
      const sessionID = stringValue(payload.sessionID || payload.id)
      if (sessionID) activeSessions.delete(sessionID)
      snapshotActiveSessions()
      return
    }

    if (type === "session.error") {
      state.errors += 1
      state.lastErrorAt = Date.now()
      const sessionID = stringValue(payload.sessionID || payload.id)
      if (sessionID) activeSessions.delete(sessionID)
      snapshotActiveSessions()
      return
    }

    if (type === "message.updated" || type === "message.part.updated") {
      collectUsageRecords(payload)
      collectFallbackAssistantMessage(payload)
    }
  }

  function handleSessionStatus(payload) {
    const sessionID = stringValue(payload.sessionID || payload.id)
    const status = stringValue(payload.status)
    if (!sessionID) return

    if (status === "active") activeSessions.add(sessionID)
    if (status === "idle" || status === "error") activeSessions.delete(sessionID)
    if (status === "error") {
      state.errors += 1
      state.lastErrorAt = Date.now()
    }
    snapshotActiveSessions()
  }

  function collectUsageRecords(payload) {
    for (const record of findUsageRecords(payload)) {
      const key = recordKey(record)
      if (!key || countedRequests.has(key)) continue

      countedRequests.add(key)
      state.totalRequests += 1
      applyUsage(record)
      addRecent(record)
    }
  }

  function collectFallbackAssistantMessage(payload) {
    const message = payload.info || payload.message || payload.part || payload
    const role = stringValue(message.role || message.type || message.info?.role || message.info?.type)
    if (role !== "assistant") return

    const messageID = stringValue(
      message.id || message.messageID || message.info?.id || message.info?.messageID || payload.messageID,
    )
    if (!messageID || countedMessages.has(messageID)) return

    const hasStepFinish = findUsageRecords(message).length > 0
    if (hasStepFinish) return

    countedMessages.add(messageID)
    state.totalRequests += 1
    addRecent({
      id: messageID,
      sessionID: message.sessionID || message.info?.sessionID || payload.sessionID,
      messageID,
      model: findStringByKey(message, ["model", "modelID", "modelId"]),
      provider: findStringByKey(message, ["provider", "providerID", "providerId"]),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      createdAt: Date.now(),
    })
  }

  function applyUsage(record) {
    state.inputTokens += record.inputTokens
    state.outputTokens += record.outputTokens
    state.totalTokens += record.totalTokens
    state.totalCost += record.cost

    const model = record.model || "unknown"
    const current = state.byModel[model] || {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    }

    current.requests += 1
    current.inputTokens += record.inputTokens
    current.outputTokens += record.outputTokens
    current.totalTokens += record.totalTokens
    current.totalCost += record.cost
    state.byModel[model] = current
  }

  function addRecent(record) {
    state.recent.unshift({
      time: record.createdAt || Date.now(),
      sessionID: record.sessionID || "",
      messageID: record.messageID || "",
      model: record.model || "unknown",
      provider: record.provider || "",
      tokens: record.totalTokens || record.inputTokens + record.outputTokens || 0,
      cost: record.cost || 0,
    })
    state.recent = state.recent.slice(0, MAX_RECENT)
    state.lastRequestAt = Date.now()
  }

  function scheduleSave() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveState().catch((error) =>
        log(ctx.client, "warn", "Failed to save LLM request stats", { error: String(error) }),
      )
    }, 300)
  }

  async function saveState() {
    snapshotActiveSessions()
    state.countedRequests = Array.from(countedRequests).slice(-2000)
    state.countedMessages = Array.from(countedMessages).slice(-2000)
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, JSON.stringify(state, null, 2))
  }

  function snapshotActiveSessions() {
    state.activeSessions = Array.from(activeSessions)
  }
}

async function loadState(statePath) {
  const base = {
    version: 1,
    totalRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    errors: 0,
    activeSessions: [],
    countedRequests: [],
    countedMessages: [],
    byModel: {},
    recent: [],
    lastRequestAt: null,
    lastErrorAt: null,
  }

  try {
    const text = await readFile(statePath, "utf8")
    const parsed = JSON.parse(text)
    return { ...base, ...parsed, byModel: parsed.byModel || {}, recent: parsed.recent || [] }
  } catch {
    return base
  }
}

function findUsageRecords(input) {
  const records = []
  walk(input, (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return

    const looksLikeFinish =
      value.type === "step-finish" ||
      value.type === "step.finish" ||
      value.type === "finish" ||
      value.usage ||
      value.tokens ||
      value.cost

    if (!looksLikeFinish) return

    const usage = value.usage || value.tokens || value
    const inputTokens = firstNumber(usage, numberKeys.input)
    const outputTokens = firstNumber(usage, numberKeys.output)
    const explicitTotal = firstNumber(usage, numberKeys.total)
    const totalTokens = explicitTotal || inputTokens + outputTokens
    const cost = firstNumber(usage, numberKeys.cost)

    if (!inputTokens && !outputTokens && !totalTokens && !cost) return

    records.push({
      id: stringValue(value.id || value.requestID || value.requestId),
      sessionID: stringValue(value.sessionID || value.sessionId || findStringByKey(value, ["sessionID", "sessionId"])),
      messageID: stringValue(value.messageID || value.messageId || findStringByKey(value, ["messageID", "messageId"])),
      model: stringValue(value.model || value.modelID || value.modelId || findStringByKey(value, ["model", "modelID", "modelId"])),
      provider: stringValue(
        value.provider ||
          value.providerID ||
          value.providerId ||
          findStringByKey(value, ["provider", "providerID", "providerId"]),
      ),
      inputTokens,
      outputTokens,
      totalTokens,
      cost,
      createdAt: firstNumber(value.time || value, ["created", "completed", "finished"]) || Date.now(),
    })
  })
  return records
}

function renderStats(state, activeSessions, statePath) {
  const topModels = Object.entries(state.byModel)
    .sort((a, b) => b[1].requests - a[1].requests)
    .slice(0, 5)

  const lines = [
    "# LLM Request Stats",
    "",
    `Requests: ${formatInt(state.totalRequests)}`,
    `Active sessions: ${formatInt(activeSessions.size)}`,
    `Errors: ${formatInt(state.errors)}`,
    `Input tokens: ${formatInt(state.inputTokens)}`,
    `Output tokens: ${formatInt(state.outputTokens)}`,
    `Total tokens: ${formatInt(state.totalTokens)}`,
    `Cost: ${formatCost(state.totalCost)}`,
    "",
    "## Top Models",
  ]

  if (topModels.length === 0) {
    lines.push("- No model usage recorded yet.")
  } else {
    for (const [model, usage] of topModels) {
      lines.push(`- ${model}: ${usage.requests} requests, ${formatInt(usage.totalTokens)} tokens, ${formatCost(usage.totalCost)}`)
    }
  }

  lines.push("", "## Recent")
  if (state.recent.length === 0) {
    lines.push("- No requests recorded yet.")
  } else {
    for (const item of state.recent.slice(0, MAX_RECENT)) {
      lines.push(`- ${formatTime(item.time)} ${item.model}: ${formatInt(item.tokens)} tokens, ${formatCost(item.cost)}`)
    }
  }

  lines.push("", `Raw state: ${statePath}`)
  return lines.join("\n")
}

function recordKey(record) {
  return [
    record.sessionID || "session",
    record.messageID || "message",
    record.id || `${record.model}:${record.totalTokens}:${record.cost}`,
  ].join(":")
}

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return
  seen.add(value)
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen)
    return
  }
  for (const item of Object.values(value)) walk(item, visit, seen)
}

function firstNumber(source, keys) {
  if (!source || typeof source !== "object") return 0

  for (const key of keys) {
    const value = source[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }

  for (const value of Object.values(source)) {
    if (value && typeof value === "object") {
      const found = firstNumber(value, keys)
      if (found) return found
    }
  }

  return 0
}

function findStringByKey(source, keys) {
  if (!source || typeof source !== "object") return ""
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value) return value
  }
  for (const value of Object.values(source)) {
    if (value && typeof value === "object") {
      const found = findStringByKey(value, keys)
      if (found) return found
    }
  }
  return ""
}

function stringValue(value) {
  return typeof value === "string" ? value : ""
}

function formatInt(value) {
  return Math.round(value || 0).toLocaleString()
}

function formatCost(value) {
  const cost = Number(value || 0)
  if (!cost) return "$0.0000"
  if (cost < 0.01) return `$${cost.toFixed(5)}`
  return `$${cost.toFixed(3)}`
}

function formatTime(value) {
  if (!value) return "-"
  return new Date(value).toLocaleTimeString()
}

async function log(client, level, message, extra) {
  try {
    await client?.app?.log?.({
      body: {
        service: PLUGIN_NAME,
        level,
        message,
        extra,
      },
    })
  } catch {
    // Logging must never break the plugin.
  }
}

export default {
  id: PLUGIN_ID,
  server,
}

