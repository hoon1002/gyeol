import { FieldMood } from '@/fx'
import { useGo } from '@/shell/hooks'
import { EmptyState, Hero } from './parts'

export function NotFoundScreen() {
  const go = useGo()
  return (
    <>
      <FieldMood preset="landing" />
      <Hero label="없는 화면" variant="low">
        <EmptyState lines={['여기엔 아무것도 없어요.', '결을 따라 오늘로 돌아가요.']} action="오늘로" onAction={(el) => void go('/', el)} />
      </Hero>
    </>
  )
}
