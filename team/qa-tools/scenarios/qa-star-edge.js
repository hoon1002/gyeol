// 별 누르기 가장자리: 패널 글자에서 시작한 끌기, 다른 별 위에서 끝난 끌기, 더블클릭, 휠, (터치) 핀치·두 번 탭
const open = async () => {
  await key('Escape'); await sleep(900)
  let s
  for (let i = 0; i < 5 && !s; i++) { s = (await stars(40, 30)).find((s) => /^today:|seed-focus|seed-task/.test(s.id)); if (!s) await sleep(700) }
  if (!s) throw new Error('별 없음')
  await tap(s.x, s.y); await sleep(1500)
  return s
}
const res = {}
await size(1440, 900); setMode('mouse'); await nav('/', 2500)
let s = await open()
const [ti] = await find('.star-info h2')
await drag(ti.x - 80, ti.y, 1300, 250, { steps: 12 }); await sleep(800)
res.dragFromTitleToSky = (await st()).star; print('A', res.dragFromTitleToSky)
s = await open()
const others = (await stars(40, 30)).filter((o) => o.id !== s.id)
const o = others[0]
if (o) { await drag(1300, 150, o.x, o.y, { steps: 12 }); await sleep(1200); res.dragEndOnOtherStar = [(await st()).star, (await find('.star-info h2'))[0]?.t] }
else { const me = (await stars(30, 24)).find((x) => x.id === s.id); if (me) { await drag(1300, 150, me.x, me.y, { steps: 12 }); await sleep(1200) } res.dragEndOnSameStar = [(await st()).star, me && [me.x, me.y]] }
s = await open()
await wheel(1250, 300, -120, 4); await sleep(100); await tap(1250, 300); await sleep(900)
res.wheelThenQuickClick = (await st()).star
s = await open()
await dbl(1250, 300); await sleep(1500)
res.dblClickSky = [(await st()).star, JSON.stringify(await ev('__qaEng.currentCamera()'))]
s = await open()
await drag(1250, 300, 1250, 300, { steps: 2, hold: 900 }); await sleep(900)
res.longPressNoMove = (await st()).star
print(res)
res.done = 1
await size(390, 844, { touch: true }); setMode('touch'); await nav('/', 2500)
const r2 = {}
s = await open(); r2.opened = (await st()).star
await pinch(200, 230, 80, 220); await sleep(900)
r2.pinchOut = (await st()).star
await pinch(200, 230, 220, 80); await sleep(900)
r2.pinchIn = (await st()).star
await t('touchStart', [[100, 200, 0]]); await sleep(30); await t('touchStart', [[100, 200, 0], [250, 260, 1]]); await sleep(30)
for (let i = 1; i <= 8; i++) { await t('touchMove', [[100 + i * 6, 200 + i * 4, 0], [250 + i * 6, 260 + i * 4, 1]]); await sleep(16) }
await t('touchEnd', []); await sleep(900)
r2.twoFingerPan = (await st()).star
await tap(300, 150, { after: 60 }); await tap(300, 150); await sleep(1500)
r2.doubleTap = (await st()).star
print(r2)
setMode('mouse')
