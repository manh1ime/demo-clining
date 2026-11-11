// POST /api/admin — API приложения для работы с лидами (страница /admin).
// Доступ только по паролю из переменной ADMIN_PASSWORD. Данные хранятся в Redis (Upstash).
import crypto from 'node:crypto'
import { hasRedis, redis } from './_lib.js'

const STAGES = ['new', 'sent', 'replied', 'interested', 'client', 'rejected']
const CHANNELS = ['wa', 'tg', 'max', 'copy']

class UserError extends Error {}

// Однострочное и многострочное поле
const line = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const text = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)
const int = (v, min, max, def) => {
  const x = Math.round(Number(v))
  return Number.isFinite(x) && String(v ?? '').trim() !== '' ? Math.min(Math.max(x, min), max) : def
}

const TR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}
const slugify = (name) =>
  [...String(name).toLowerCase()]
    .map((c) => (c in TR ? TR[c] : c))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '')

const safeEqual = (a, b) => {
  const A = Buffer.from(String(a))
  const B = Buffer.from(String(b))
  return A.length === B.length && crypto.timingSafeEqual(A, B)
}

function normalize(b, prev) {
  const now = new Date().toISOString()
  const name = line(b.name, 80)
  if (!name) throw new UserError('Укажите название компании')
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent.toLowerCase() : '#2054ec'
  return {
    id: prev?.id || null,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    status: STAGES.includes(b.status) ? b.status : prev?.status || 'new',
    history: Array.isArray(prev?.history) ? prev.history : [],
    // Компания
    name,
    city: line(b.city, 60),
    phone: line(b.phone, 30),
    email: line(b.email, 80),
    address: line(b.address, 160),
    hours: line(b.hours, 80),
    contactName: line(b.contactName, 60),
    // Куда писать
    tg: line(b.tg, 80),
    wa: line(b.wa, 30),
    max: line(b.max, 160),
    vk: line(b.vk, 160),
    // Источники и заметки
    links: text(b.links, 3000),
    notes: text(b.notes, 5000),
    // Сайт-пример
    logoText: line(b.logoText, 40),
    bottleName: line(b.bottleName, 12),
    bottleLine1: line(b.bottleLine1, 24),
    accent,
    regular: int(b.regular, 1, 100000, 70),
    deep: int(b.deep, 1, 100000, 130),
    renovation: int(b.renovation, 1, 100000, 170),
    minOrder: int(b.minOrder, 0, 10000000, 2500),
  }
}

const getProspect = async (id) => {
  const raw = await redis('GET', `prospect:${id}`)
  return raw ? JSON.parse(raw) : null
}
const putProspect = async (p) => {
  await redis('SET', `prospect:${p.id}`, JSON.stringify(p))
  await redis('ZADD', 'prospects', Date.parse(p.updatedAt), p.id)
}
const hashToObj = (arr) => {
  const o = {}
  for (let i = 0; Array.isArray(arr) && i < arr.length; i += 2) o[arr[i]] = arr[i + 1]
  return o
}
const validId = (id) => /^[a-z0-9-]{2,60}$/.test(String(id || ''))

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const pass = process.env.ADMIN_PASSWORD
  if (!pass) return res.status(503).json({ error: 'Приложение выключено: задайте ADMIN_PASSWORD в настройках Vercel' })
  if (!safeEqual(req.headers['x-admin-key'] || '', pass)) return res.status(401).json({ error: 'Неверный пароль' })
  if (!hasRedis()) return res.status(503).json({ error: 'Подключите Redis (Vercel → Storage → Upstash Redis)' })

  let b = req.body
  if (typeof b === 'string') {
    try { b = JSON.parse(b) } catch { b = {} }
  }
  b = b || {}

  try {
    switch (b.action) {
      case 'ping':
        return res.status(200).json({ ok: true })

      case 'list': {
        const ids = (await redis('ZREVRANGE', 'prospects', 0, 1999)) || []
        const raws = ids.length ? await redis('MGET', ...ids.map((id) => `prospect:${id}`)) : []
        const [views, last, leads] = await Promise.all([
          redis('HGETALL', 'pv'),
          redis('HGETALL', 'pvlast'),
          redis('HGETALL', 'pvleads'),
        ]).then((r) => r.map(hashToObj))
        const items = raws.filter(Boolean).map((raw) => {
          const p = JSON.parse(raw)
          return { ...p, views: Number(views[p.id] || 0), lastView: last[p.id] || null, formLeads: Number(leads[p.id] || 0) }
        })
        return res.status(200).json({ ok: true, items })
      }

      case 'save': {
        const src = b.prospect || {}
        const prev = validId(src.id) ? await getProspect(src.id) : null
        const p = normalize(src, prev)
        if (!p.id) {
          const base = slugify(p.name) || 'company'
          for (let i = 0; i < 5 && !p.id; i++) {
            const id = `${base}-${crypto.randomBytes(3).toString('hex').slice(0, 4)}`
            const ok = await redis('SET', `prospect:${id}`, JSON.stringify({ ...p, id }), 'NX')
            if (ok) p.id = id
          }
          if (!p.id) throw new Error('Не удалось создать адрес для лида')
        }
        await putProspect(p)
        return res.status(200).json({ ok: true, item: p })
      }

      case 'log': {
        if (!validId(b.id)) throw new UserError('Нет лида')
        const p = await getProspect(b.id)
        if (!p) throw new UserError('Лид не найден')
        const channel = CHANNELS.includes(b.channel) ? b.channel : 'copy'
        p.history = [...(p.history || []), { at: new Date().toISOString(), type: 'message', channel, template: line(b.template, 60) }].slice(-50)
        if (p.status === 'new') p.status = 'sent'
        p.updatedAt = new Date().toISOString()
        await putProspect(p)
        return res.status(200).json({ ok: true, item: p })
      }

      case 'delete': {
        if (!validId(b.id)) throw new UserError('Нет лида')
        await redis('DEL', `prospect:${b.id}`)
        await redis('ZREM', 'prospects', b.id)
        await Promise.all(['pv', 'pvlast', 'pvleads'].map((h) => redis('HDEL', h, b.id)))
        return res.status(200).json({ ok: true })
      }

      default:
        throw new UserError('Неизвестное действие')
    }
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message })
    console.error(e)
    return res.status(500).json({ error: 'Ошибка сервера: ' + String(e.message || e) })
  }
}
