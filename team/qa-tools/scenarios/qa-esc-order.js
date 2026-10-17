// 겹침 · Esc 순서 · 포커스 복귀 (데스크톱)
const S = async () => { const s = await st(); return `[${s.star ? '★' : ''}${s.layers.filter((l) => /palette|sheet|memo-layer|dust|star-info|settings|cmdk/i.test(l)).map((l) => l.split(/[.[]/)[1]).join('+')}] focus=${s.focus}` }
const openStar = async () => {
  await nav('/', 3000)
  let s
  for (let i = 0; i < 5 && !s; i++) { s = (await stars(40, 30)).find((x) => /^today:|seed-focus|seed-task/.test(x.id)); if (!s) await sleep(700) }
  await tap(s.x, s.y); await sleep(1500)
}
await size(1440, 900); setMode('mouse')
const out = []
await openStar(); out.push('O1 star ' + await S())
await key('k', 4); await sleep(400); out.push('  +⌘K ' + await S())
await key('Escape'); await sleep(500); out.push('  Esc ' + await S())
await key('Escape'); await sleep(900); out.push('  Esc ' + await S())
await openStar()
await key(',', 4); await sleep(500); out.push('O5 star+⌘, ' + await S())
await key('Escape'); await sleep(600); out.push('  Esc ' + await S())
await openStar()
await key('n'); await sleep(300); out.push('O6 star+n ' + await S())
await key('Escape'); await sleep(500); out.push('  Esc ' + await S())
await nav('/', 2500)
await key('n'); await sleep(300); await type('memo', 10); out.push('O2 memo ' + await S())
await key('k', 4); await sleep(400); out.push('  +⌘K ' + await S())
await key('Escape'); await sleep(500); out.push('  Esc ' + await S() + ' memo=' + await ev(`document.querySelector('.memo-input')?.value`))
await key('Escape'); await sleep(500); out.push('  Esc ' + await S())
await key(',', 4); await sleep(500); out.push('O3 settings ' + await S())
await key('n'); await sleep(300); out.push('  +n ' + await S())
await key('Escape'); await sleep(500); out.push('  Esc ' + await S())
await key('k', 4); await sleep(400); await key('n'); await sleep(300); out.push('O7 ⌘K + n ' + await S() + ' input=' + await ev(`document.activeElement.value`))
await key('Escape'); await sleep(400)
const [dl] = await find('button', '별가루')
if (dl) { await tap(dl.x, dl.y); await sleep(700); out.push('O4 dust ' + await S())
  await key('k', 4); await sleep(400); out.push('  +⌘K ' + await S())
  await key('Escape'); await sleep(500); out.push('  Esc ' + await S())
  await key('Escape'); await sleep(500); out.push('  Esc ' + await S()) }
print(out.join('\n'))
print(logs().filter((l) => !/Failed to load resource/.test(l.text)))
