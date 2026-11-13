// One source of company data for browser and server. Bundle config.js on Vercel.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const sandbox = { window: {} }
vm.runInNewContext(readFileSync(new URL('../config.js', import.meta.url), 'utf8'), sandbox, { timeout: 100 })
export const site = sandbox.window.SITE
export function estimate(source, b) {
  const key = { 'Поддерживающая': 'regular', 'Генеральная': 'deep', 'После ремонта': 'renovation', regular: 'regular', deep: 'deep', renovation: 'renovation' }[b.service]
  const area = Number(b.area)
  if (!key || !Number.isInteger(area) || area < 20 || area > 250) throw new Error('Некорректный вид уборки или площадь (20–250 м²)')
  const pricing = source.pricing || source
  const rates = pricing.rates || pricing
  const extras = Array.isArray(pricing.extras) ? pricing.extras : site.pricing.extras
  const selected = [...new Set(Array.isArray(b.extras) ? b.extras : [])]
  if (selected.some(title => !extras.some(x => x.title === title))) throw new Error('Неизвестная дополнительная услуга')
  return { area, service: { regular: 'Поддерживающая', deep: 'Генеральная', renovation: 'После ремонта' }[key], extras: selected,
    total: Math.max(Number(pricing.minOrder), area * Number(rates[key])) + selected.reduce((sum, title) => sum + Number(extras.find(x => x.title === title).price), 0) }
}
