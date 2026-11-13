import crypto from 'node:crypto'
import { redis } from './_lib.js'
const equal = (a,b) => { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y) }
const sign = value => crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || '').update(value).digest('hex')
export const checkPassword = value => equal(value, process.env.ADMIN_PASSWORD || '')
export const ipKey = req => crypto.createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()).digest('hex').slice(0,32)
export async function limit(key, maximum, seconds) {
  const count = Number(await redis('INCR', key))
  if (count === 1) await redis('EXPIRE', key, seconds)
  return count <= maximum
}
export function sameOrigin(req) {
  if (req.headers['x-requested-with'] !== 'cleaning-admin') return false
  const origin=req.headers.origin
  if (!origin) return true // non-browser clients still need a valid session
  try { return new URL(origin).host === String(req.headers.host) } catch { return false }
}
export function authenticated(req) {
  const cookies = String(req.headers.cookie || '').split(';').map(s=>s.trim())
  const raw = cookies.find(s=>s.startsWith('cleaning_session='))?.slice(17) || ''
  const [exp, nonce, signature] = raw.split('.')
  return !!nonce && Number(exp)>Date.now() && Number(exp)<Date.now()+9*3600000 && equal(signature,sign(exp+'.'+nonce))
}
export function session(res, clear=false) {
  const value = String(Date.now()+8*3600000)+'.'+crypto.randomBytes(18).toString('hex')
  res.setHeader('Set-Cookie', 'cleaning_session='+(clear?'':value+'.'+sign(value))+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+(clear?'0':'28800')+(process.env.NODE_ENV==='test'?'':'; Secure'))
}
