// page-injector.js (main world)
// Patches window.fetch so we can tee SSE response streams from Claude.ai's
// chat completion endpoints and read the `message_limit` event without
// disturbing the page's own consumption of the stream.

(function () {
  if (window.__claudeUsageMeterInjected) return;
  window.__claudeUsageMeterInjected = true;

  const ORIGINAL_FETCH = window.fetch.bind(window);

  function postToContent(payload) {
    window.postMessage(
      { source: "claude-usage-meter", payload },
      window.location.origin
    );
  }

  function isCompletionUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /claude\.ai\/api\/.*\/(completion|retry_completion)(\?|$)/.test(url);
  }

  // Recursively look through any parsed JSON object for fields that look like
  // a remaining-message count. Claude's SSE payloads embed message-limit info
  // in a few different shapes depending on the event type, so we scan loosely.
  const REMAINING_KEYS = [
    "remaining", "messages_remaining", "messages_left",
    "remainingMessages", "remaining_messages", "n_remaining"
  ];

  function findRemaining(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    for (const k of Object.keys(obj)) {
      if (REMAINING_KEYS.includes(k) && typeof obj[k] === "number") return obj[k];
      const v = obj[k];
      if (v && typeof v === "object") {
        const r = findRemaining(v, depth + 1);
        if (r != null) return r;
      }
    }
    return null;
  }

  function findResetAt(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    for (const k of Object.keys(obj)) {
      const lower = k.toLowerCase();
      if ((lower.includes("reset") || lower.includes("resetsat")) && typeof obj[k] === "string") {
        return obj[k];
      }
      const v = obj[k];
      if (v && typeof v === "object") {
        const r = findResetAt(v, depth + 1);
        if (r != null) return r;
      }
    }
    return null;
  }

  function looksLikeMessageLimit(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (obj.type && typeof obj.type === "string" &&
        obj.type.toLowerCase().includes("message_limit")) return true;
    if (obj.message_limit && typeof obj.message_limit === "object") return true;
    if (obj.event && typeof obj.event === "string" &&
        obj.event.toLowerCase().includes("limit")) return true;
    return false;
  }

  function inspectJsonChunk(jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);
      // Two cases worth emitting:
      // (a) The object explicitly references message_limit
      // (b) The object has a remaining-messages-shaped number somewhere
      if (looksLikeMessageLimit(obj) || findRemaining(obj) != null) {
        const remaining = findRemaining(obj);
        const resetsAt = findResetAt(obj);
        if (remaining != null || resetsAt) {
          postToContent({
            kind: "message_limit",
            remaining,
            resetsAt: resetsAt || null,
            ts: Date.now()
          });
        }
      }
    } catch (_) { /* not JSON or partial */ }
  }

  async function teeAndScanSSE(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE events are separated by a blank line.
        let sep;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const eventBlock = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          // Concatenate all `data:` payload lines within the event.
          const dataLines = [];
          for (const rawLine of eventBlock.split("\n")) {
            if (rawLine.startsWith("data:")) {
              dataLines.push(rawLine.slice(5).replace(/^ /, ""));
            }
          }
          if (dataLines.length === 0) continue;
          inspectJsonChunk(dataLines.join("\n"));
        }
      }
    } catch (_) { /* stream cancelled or aborted — fine */ }
  }

  window.fetch = async function patchedFetch(input, init) {
    const response = await ORIGINAL_FETCH(input, init);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (!isCompletionUrl(url)) return response;
      if (!response.body) return response;

      // Tee the body so the page gets one branch and we scan the other.
      const [forPage, forScan] = response.body.tee();
      teeAndScanSSE(forScan);

      // Re-wrap with the page-bound stream. Preserve all other response metadata.
      const wrapped = new Response(forPage, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      // Preserve URL field where possible
      try { Object.defineProperty(wrapped, "url", { value: response.url }); } catch (_) {}
      return wrapped;
    } catch (e) {
      // Never let interception break the page.
      return response;
    }
  };
})();
