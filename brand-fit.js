/* Shared deterministic canvas typography. Full text, including unbroken names. */
(() => {
  'use strict'
  function wrap(ctx, text, width) {
    const lines = []; let line = ''
    for (const word of String(text || '').trim().split(/\s+/u).filter(Boolean)) {
      const joined = line ? line + ' ' + word : word
      if (ctx.measureText(joined).width <= width) { line = joined; continue }
      if (line) { lines.push(line); line = '' }
      if (ctx.measureText(word).width <= width) { line = word; continue }
      for (const ch of Array.from(word)) {
        if (line && ctx.measureText(line + ch).width > width) { lines.push(line); line = '' }
        line += ch
      }
    }
    if (line) lines.push(line)
    return lines
  }
  function fit(ctx, text, { width, height, maxFont = 160, minFont = 36, maxLines = 6, weight = 650, lineHeight = 1.16 }) {
    for (let size = maxFont; size >= minFont; size -= 2) {
      ctx.font = weight + ' ' + size + 'px Arial, sans-serif'
      const lines = wrap(ctx, text, width)
      if (lines.length <= maxLines && lines.length * size * lineHeight <= height && lines.every(l => ctx.measureText(l).width <= width)) {
        return { lines, size, lineHeight: size * lineHeight }
      }
    }
    // Supported CRM names (up to 80 characters) fit above. Never silently truncate an out-of-range input.
    ctx.font = weight + ' ' + minFont + 'px Arial, sans-serif'
    const lines = wrap(ctx, text, width)
    return { lines, size: minFont, lineHeight: minFont * lineHeight }
  }
  window.BrandText = { wrap, fit }
})()
