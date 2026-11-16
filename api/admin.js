// POST /api/admin — API приложения для работы с лидами (страница /admin).
// Доступ только по паролю из переменной ADMIN_PASSWORD. Данные хранятся в Redis (Upstash).
import crypto from 'node:crypto'
import { hasRedis, redis } from './_lib.js'
import { authenticated, checkPassword, sameOrigin, session, limit, ipKey } from './_auth.js'

const STAGES = ['new', 'sent', 'replied', 'interested', 'client', 'rejected']
const CHANNELS = ['wa', 'tg', 'max', 'vk', 'copy']
const GROUPS = ['new_site','existing_site','qualify','fix','reserve']
const firmId = p => String(p.sourceFirmId || '').match(/^\d{15,17}$/)?.[0] || String(p.links || '').match(/2gis\.ru\/[^\s]*?firm\/(\d{15,17})/)?.[1] || ''

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
    group: GROUPS.includes(b.group) ? b.group : prev?.group || 'qualify',
    sourceFirmId: firmId(b) || prev?.sourceFirmId || '',
    nextAction: text(b.nextAction, 1500),
    offer: text(b.offer, 1500),
    firstMessage: text(b.firstMessage, 2500),
    priority: int(b.priority, 0, 1000, 0),
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
    logoText: line(b.logoText, 80),
    bottleName: line(b.bottleName, 80),
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
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос запрещён' })
  if (!hasRedis()) return res.status(503).json({ error: 'Подключите Redis (Vercel → Storage → Upstash Redis)' })

  let b = req.body
  if (typeof b === 'string') {
    try { b = JSON.parse(b) } catch { b = {} }
  }
  b = b || {}

  try {
    if (b.action === 'login') {
      if (!(await limit('login:'+ipKey(req), 10, 900))) return res.status(429).json({ error: 'Слишком много попыток. Повторите через 15 минут.' })
      if (!checkPassword(b.password || '')) return res.status(401).json({ error: 'Неверный пароль' })
      session(res)
      return res.status(200).json({ ok: true })
    }
    if (b.action === 'logout') { session(res, true); return res.status(200).json({ok:true}) }
    if (!authenticated(req)) return res.status(401).json({ error: 'Войдите в приложение' })
    switch (b.action) {
      case 'ping':
        return res.status(200).json({ ok: true })

      case 'list': {
        let offset = Math.max(0, Number.parseInt(b.offset,10) || 0)
        const total = Number(await redis('ZCARD', 'prospects'))
        const query = line(b.query,100).toLowerCase(), stage = STAGES.includes(b.stage) ? b.stage : '', group = GROUPS.includes(b.group) ? b.group : ''
        const digits = query.replace(/\D/g,'')
        const found=[]
        // Read in bounded batches, including companies beyond the first page.
        while(offset < total && found.length < 100) {
          const ids=(await redis('ZREVRANGE','prospects',offset,offset+199)) || []
          if(!ids.length)break
          const raws=await redis('MGET',...ids.map(id=>'prospect:'+id))
          for(let i=0;i<ids.length;i++) {
            offset++
            if(!raws[i])continue
            const p=JSON.parse(raws[i])
            const hay=[p.name,p.city,p.phone,p.wa,p.contactName,p.address,p.notes].join(' ').toLowerCase()
            const matches=!query || hay.includes(query) || (digits.length>=3 && [p.phone,p.wa].some(v=>String(v||'').replace(/\D/g,'').includes(digits)))
            if((!stage || p.status===stage)&&(!group || (p.group || 'qualify')===group)&&matches)found.push(p)
            if(found.length>=100)break
          }
        }
        const [views, last, leads] = await Promise.all([
          redis('HGETALL', 'pv'),
          redis('HGETALL', 'pvlast'),
          redis('HGETALL', 'pvleads'),
        ]).then((r) => r.map(hashToObj))
        const items = found.map(p => ({...p,views:Number(views[p.id]||0),lastView:last[p.id]||null,formLeads:Number(leads[p.id]||0)}))
        return res.status(200).json({ ok: true, items, total, nextOffset: offset < total ? offset : null })
      }

      case 'importOne': {
        // Import is authenticated, one record per request, resumable by stable source ID.
        const src=b.prospect || {}, fid=firmId(src)
        if(!fid || !String(src.name || '').trim())throw new UserError('Нужны название и источник 2ГИС')
        const stableId='imp-'+crypto.createHmac('sha256',pass).update('crm-import-v1:'+fid).digest('hex').slice(0,40)
        let prev=validId(b.existingId) ? await getProspect(b.existingId) : await getProspect(stableId)
        if(prev && firmId(prev)!==fid)throw new UserError('Конфликт источника: проверьте карточку вручную')
        if(prev) {
          // Never replace history, deal state, notes, tariffs or nonempty contacts.
          const merged={...prev}
          for(const key of ['city','phone','email','address','hours','contactName','tg','wa','max','vk','group','sourceFirmId','nextAction','offer','firstMessage','priority']) {
            if(!merged[key] && src[key]) merged[key]=src[key]
          }
          const links=new Set(String(prev.links || '').split(/\n+/).filter(Boolean))
          for(const link of String(src.links || '').split(/\n+/).filter(Boolean))links.add(link)
          merged.links=[...links].join('\n').slice(0,3000)
          const next=normalize(merged,prev)
          // Compare-and-set refuses a simultaneous manual edit rather than overwriting it.
          const before=JSON.stringify(prev), after=JSON.stringify(next)
          const saved=await redis('EVAL',"-- IMPORT_CAS\nif redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2]);redis.call('ZADD',KEYS[2],ARGV[3],ARGV[4]);return 1",2,'prospect:'+prev.id,'prospects',before,after,Date.parse(next.updatedAt),next.id)
          if(Number(saved)!==1)return res.status(409).json({error:'Карточка изменена параллельно. Повторите импорт: данные не перезаписаны.'})
          return res.status(200).json({ok:true,result:'existing',item:next})
        }
        const next=normalize({...src,status:'new'},null);next.id=stableId
        // Imported notes must explicitly describe unknown outreach history.
        next.notes=text(src.notes,5000)
        const created=await redis('SET','prospect:'+stableId,JSON.stringify(next),'NX')
        const item=created ? next : await getProspect(stableId)
        if(!item)throw new Error('Import record unavailable')
        await redis('ZADD','prospects',Date.parse(item.updatedAt),item.id)
        return res.status(200).json({ok:true,result:created?'created':'existing',item})
      }

      case 'save': {
        const src = b.prospect || {}
        const prev = validId(src.id) ? await getProspect(src.id) : null
        const p = normalize(src, prev)
        if (!p.id) {
          const base = slugify(p.name) || 'company'
          for (let i = 0; i < 5 && !p.id; i++) {
            const id = `${base}-${crypto.randomBytes(10).toString('hex')}`
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
        p.history = [...(p.history || []), { at: new Date().toISOString(), type: b.confirmed === true ? 'sent' : 'prepared', channel, template: line(b.template, 60) }].slice(-50)
        if (b.confirmed === true && p.status === 'new') p.status = 'sent'
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
    return res.status(500).json({ error: 'Сервис временно недоступен. Повторите позже.' })
  }
}
