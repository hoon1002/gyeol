/** 없는 화면 (design-quiet 1-12): "없는 화면" 한 줄 + 금빛 오늘 아이콘 */
import { FieldMood } from '@/fx'
import { useGo } from '@/shell/hooks'
import { IconToday } from '@/shell/icons'
import { tip } from '@/shell/Tip'
import { Block, FocusLines, Hero } from './parts'

export function NotFoundScreen() {
  const go = useGo()
  return (
    <>
      <FieldMood preset="landing" />
      <Hero label="없는 화면" variant="low">
        <Block>
          <FocusLines lines={['없는 화면']} />
        </Block>
        <div className="today-acts">
          <button type="button" className="gold-btn" {...tip('오늘로')} onClick={(e) => void go('/', e.currentTarget)}>
            <IconToday size={24} />
          </button>
        </div>
      </Hero>
    </>
  )
}
