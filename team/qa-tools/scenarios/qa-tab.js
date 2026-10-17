// Tab 순서 · 포커스 링 · 보이지 않는 요소에 포커스
await size(1440, 900); setMode('mouse')
for (const p of ['/', '/notes', '/plan', '/focus', '/review']) {
  await nav(p, 2600)
  await m('mousePressed', 1300, 700); await m('mouseReleased', 1300, 700); await sleep(200)
  const seen = []
  for (let i = 0; i < 16; i++) {
    await key('Tab')
    const f = await ev(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'body'; const cs = getComputedStyle(a); let o = 1, x = a; while (x && x !== document.body) { o *= +getComputedStyle(x).opacity; x = x.parentElement } const ring = (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none') || (cs.boxShadow && cs.boxShadow !== 'none'); const r = a.getBoundingClientRect(); const on = r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; return (a.getAttribute('aria-label') || a.innerText || a.placeholder || a.className).toString().trim().slice(0, 14).replace(/\\n/g, '/') + (ring ? '' : '[링없음]') + (o < 0.05 ? '[투명]' : '') + (on ? '' : '[화면밖]') })()`)
    seen.push(f)
    if (i > 2 && f === seen[0]) break
  }
  print(p, seen.join(' → '))
}
