// 터치(폰): 별 누르기 뒤 핀치·두 손가락 이동·두 번 탭
const open = async () => {
  await key('Escape'); await sleep(900)
  let s
  for (let i = 0; i < 5 && !s; i++) { s = (await stars(40, 30)).find((s) => /^today:|seed-focus|seed-task/.test(s.id)); if (!s) await sleep(700) }
  if (!s) throw new Error('별 없음')
  await tap(s.x, s.y); await sleep(1500)
  return s
}
let s
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
