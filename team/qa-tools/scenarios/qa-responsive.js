// 반응형: 크기 4종 × 장소 6곳 — 가로 스크롤, 화면 밖 요소, 크롬(레일·독·위 줄)과 겹침, 잘린 글
const sizes = [[390, 844, true], [844, 390, true], [1180, 820, true], [820, 1180, true], [1440, 900, false]]
const places = ['/', '/notes', '/map', '/review', '/plan', '/focus']
const check = `(() => {
  const W = innerWidth, H = innerHeight
  const vis = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || e.closest('[inert],[aria-hidden=true]')) return false; let o = 1, x = e; while (x && x !== document.body) { const cs = getComputedStyle(x); if (cs.visibility === 'hidden' || cs.display === 'none') return false; o *= +cs.opacity; x = x.parentElement } return o > 0.05 }
  const name = (e) => (e.getAttribute('aria-label') || e.innerText || e.className || e.tagName).toString().trim().slice(0, 18).replace(/\\n/g, '/')
  const leaves = [...document.querySelectorAll('#stage button, #stage a, #stage h1, #stage h2, #stage p, #stage input, #stage li, .star-info *')].filter(vis)
  const off = leaves.filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 || r.left < -1 || r.bottom > H + 1 }).map((e) => { const r = e.getBoundingClientRect(); return name(e) + '@' + Math.round(r.left) + '..' + Math.round(r.right) + ',' + Math.round(r.bottom) })
  const chrome = [...document.querySelectorAll('.dock, .rail, nav, .topbar, header')].filter(vis).map((e) => e.getBoundingClientRect())
  const hit = leaves.filter((e) => !e.closest('.dock, .rail, nav, .topbar, header')).filter((e) => { const r = e.getBoundingClientRect(); return chrome.some((c) => r.left < c.right - 2 && r.right > c.left + 2 && r.top < c.bottom - 2 && r.bottom > c.top + 2) }).map(name)
  const clip = leaves.filter((e) => e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).textOverflow !== 'ellipsis' && getComputedStyle(e).overflowX !== 'visible' && e.tagName !== 'INPUT').map(name)
  return { hs: document.scrollingElement.scrollWidth > W + 1 ? document.scrollingElement.scrollWidth : 0, off: off.slice(0, 4), overChrome: [...new Set(hit)].slice(0, 4), clip: clip.slice(0, 3) }
})()`
for (const [w, h, touch] of sizes) {
  await size(w, h, { touch })
  for (const p of places) {
    await nav(p, 2600)
    const r = await ev(check)
    const bad = r.hs || r.off.length || r.overChrome.length || r.clip.length
    if (bad) { print(`${w}x${h} ${p}`, JSON.stringify(r)); await shot(`qa-resp${p === '/' ? '-today' : p.replace('/', '-')}_${w}x${h}`, { clip: { x: 0, y: 0, width: w, height: h }, scale: 0.5 }) }
  }
}
print('done')
await size(1440, 900)
