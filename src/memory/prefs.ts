/** 기억 엔진 설정 읽기 (앱 A). 저장은 앱 B의 settings 스토어: retention(0.85–0.95, 기본 0.90) · newPerDay(20) · maxPerDay(200) · memoryBrightness(켬) */
import { useSettings } from '@/stores/settings'

const s = () => useSettings.getState() as Partial<ReturnType<typeof useSettings.getState>>

export function targetRetention(): number {
  const r = s().retention
  return typeof r === 'number' && r >= 0.7 && r <= 0.99 ? r : 0.9
}
export function newPerDay(): number {
  const n = s().newPerDay
  return typeof n === 'number' && n >= 0 ? n : 20
}
export function maxPerDay(): number {
  const n = s().maxPerDay
  return typeof n === 'number' && n > 0 ? n : 200
}
export function memoryBrightOn(): boolean {
  return s().memoryBrightness !== false
}
