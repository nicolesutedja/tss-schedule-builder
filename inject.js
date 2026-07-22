(function () {
  const TARGET_KEYWORDS = ["_sections", "YUCSD_CON_EVENTS"];
  const BATCH_MARKER = "$batch";

  function isTargetUrl(url) {
    return TARGET_KEYWORDS.some((kw) => url.includes(kw));
  }

  function broadcast(payload) {
    console.log("[TSS Extension] Captured Payload:", payload); // Debug log
    window.postMessage({ source: "tss-schedule-ext", type: "events", payload }, "*");
  }

  function safeParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function extractBatchParts(text) {
    const parts = [];
    if (!text || typeof text !== "string") return parts;

    let boundary = null;
    const startMatch = text.match(/^--(\S+?)(--)?\r?\n/);
    if (startMatch) boundary = startMatch[1];
    if (!boundary) {
      const endMatch = text.match(/--([A-Za-z0-9_.:-]{8,})--\s*$/);
      if (endMatch) boundary = endMatch[1];
    }
    if (!boundary) return parts;

    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const splitter = new RegExp("--" + escaped + "(--)?");
    const chunks = text.split(splitter).filter(Boolean);
    chunks.forEach((chunk) => {
      const start = chunk.indexOf("{");
      const end = chunk.lastIndexOf("}");
      if (start === -1 || end === -1 || end < start) return;
      const obj = safeParse(chunk.slice(start, end + 1));
      if (obj) parts.push(obj);
    });
    return parts;
  }

  function handleResponseText(url, text) {
    try {
      if (url.includes(BATCH_MARKER)) {
        extractBatchParts(text).forEach((obj) => {
          if (obj && Array.isArray(obj.value) && obj.value.length) {
            broadcast(obj.value);
          }
        });
      } else if (isTargetUrl(url)) {
        const data = safeParse(text);
        if (data && Array.isArray(data.value)) {
          broadcast(data.value);
        } else if (data && Array.isArray(data)) {
          broadcast(data);
        }
      }
    } catch (e) {
      console.error("[TSS Extension] Error parsing response:", e);
    }
  }

  // --- Patch XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__tssUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener("load", function () {
      if (this.__tssUrl) {
        handleResponseText(this.__tssUrl, this.responseText);
      }
    });
    return origSend.apply(this, arguments);
  };

  // --- Patch fetch ---
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const p = origFetch.apply(this, arguments);
      if (isTargetUrl(url) || url.includes(BATCH_MARKER)) {
        p.then((res) => res.clone().text())
          .then((text) => handleResponseText(url, text))
          .catch(() => {});
      }
      return p;
    };
  }
})();