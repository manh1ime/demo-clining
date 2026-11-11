// GET /api/preview?slug=... — подставляет данные лида в шаблон сайта.
// Подключается страницей /p/<slug> сразу после config.js и перекрывает его значения.
// Наружу отдаются только данные для сайта — заметки, статусы и история остаются в приложении.
import { hasRedis, redis } from './_lib.js'

const digits = (v) => String(v || '').replace(/\D/g, '')
const ru = (d) => (d.length === 11 && d[0] === '8' ? '7' + d.slice(1) : d.length === 10 ? '7' + d : d)
const isUrl = (v) => /^https?:\/\/[^\s]+$/i.test(String(v || ''))

function tgUrl(v) {
  v = String(v || '').trim()
  if (!v) return ''
  if (isUrl(v)) return v
  const m = v.replace(/^@/, '').match(/^[A-Za-z0-9_]{4,32}$/)
  return m ? 'https://t.me/' + m[0] : ''
}

function siteData(p) {
  const name = p.name
  const phone = ru(digits(p.phone))
  const wa = ru(digits(p.wa || p.phone))
  const bottle = (p.bottleName || name.replace(/[«»"'`]/g, '').split(/\s+/)[0] || 'БРЕНД').toUpperCase().slice(0, 12)
  const brand = { name, logoText: p.logoText || name, bottleName: bottle, accent: p.accent || '#2054ec' }
  if (p.bottleLine1) brand.bottleLine1 = p.bottleLine1
  return {
    brand,
    city: p.city || '',
    contacts: {
      phone: p.phone || '',
      phoneHref: phone ? '+' + phone : '',
      email: p.email || '',
      address: p.address || '',
      hours: p.hours || '',
      telegram: tgUrl(p.tg),
      whatsapp: p.wa && wa ? 'https://wa.me/' + wa : '',
      vk: isUrl(p.vk) ? p.vk : '',
    },
    legal: { companyName: name, inn: '', ogrn: '', legalAddress: p.address || '', privacyEmail: p.email || '', privacyDate: '' },
    pricing: { rates: { regular: p.regular, deep: p.deep, renovation: p.renovation }, minOrder: p.minOrder },
  }
}

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|telegram|whatsapp|vkshare|yandex|headless/i

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const slug = String(req.query?.slug || '').toLowerCase()
  if (!/^[a-z0-9-]{2,60}$/.test(slug) || !hasRedis()) return res.status(200).send('/* пример не найден */')

  try {
    const raw = await redis('GET', `prospect:${slug}`)
    if (!raw) return res.status(200).send('/* пример не найден */')
    const p = JSON.parse(raw)

    // Считаем просмотры компании (свои просмотры из приложения и ботов не считаем)
    const own = req.query?.own === '1'
    if (!own && !BOTS.test(String(req.headers['user-agent'] || ''))) {
      await redis('HINCRBY', 'pv', slug, 1)
      await redis('HSET', 'pvlast', slug, new Date().toISOString())
    }

    const data = JSON.stringify(siteData(p)).replace(/</g, '\\u003c')
    return res.status(200).send(
      `(function(o){var S=window.SITE=window.SITE||{};for(var k in o){var v=o[k];S[k]=v&&typeof v==='object'&&!Array.isArray(v)?Object.assign({},S[k],v):v}S.preview=${JSON.stringify(slug)}})(${data});`
    )
  } catch (e) {
    console.error(e)
    return res.status(200).send('/* ошибка загрузки примера */')
  }
}
