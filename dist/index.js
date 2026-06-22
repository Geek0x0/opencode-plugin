const PLUGIN_ID = "llm-call-count-sidebar"

async function server(ctx) {
  await log(ctx.client, "info", "LLM call count sidebar server initialized")
  return {}
}

async function log(client, level, message, extra) {
  try {
    await client?.app?.log?.({
      body: {
        service: PLUGIN_ID,
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

