import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {services,request} from './helpers.mjs'
process.env.NODE_ENV='test'
process.env.ADMIN_PASSWORD='test-password-not-a-real-secret'
process.env.KV_REST_API_URL='https://redis.test'
process.env.KV_REST_API_TOKEN='test'
process.env.TELEGRAM_WEBHOOK_SECRET='test-webhook-secret'
process.env.TELEGRAM_BOT_TOKEN='test-token'
process.env.TELEGRAM_CHAT_ID='100'
const svc=services();globalThis.fetch=svc.fetch
const {default:admin}=await import('../api/admin.js')
const {default:lead}=await import('../api/lead.js')
const {default:preview}=await import('../api/preview.js')
const {default:telegram}=await import('../api/telegram.js')
const {site,estimate}=await import('../api/_config.js')
const {authenticated}=await import('../api/_auth.js')
const {redis}=await import('../api/_lib.js')
let cookie,id
const submit={name:'Тест',phone:'+7 (999) 123-45-67',consent:true,service:'regular',area:50,extras:[]}
const act=(body,headers={})=>request(admin,{body,headers:{cookie,...headers}})
test('admin rejects unauthenticated request',async()=>assert.equal((await act({action:'list'})).statusCode,401))
test('cross-origin and absent CSRF header rejected',async()=>{
 assert.equal((await act({action:'login',password:process.env.ADMIN_PASSWORD},{origin:'https://evil.test'})).statusCode,403)
 assert.equal((await act({action:'login'},{'x-requested-with':''})).statusCode,403)
})
test('login issues HttpOnly session without exposing password',async()=>{
 const r=await act({action:'login',password:process.env.ADMIN_PASSWORD})
 assert.equal(r.statusCode,200);cookie=r.headers['set-cookie'].split(';')[0]
 assert.match(r.headers['set-cookie'],/HttpOnly; SameSite=Strict/)
 assert(!JSON.stringify(r.body).includes(process.env.ADMIN_PASSWORD))
})
test('tampered session rejected',()=>assert.equal(authenticated({headers:{cookie:cookie+'x'}}),false))
test('create company and long public demo link',async()=>{
 const r=await act({action:'save',prospect:{name:'Чистый дом',phone:'+79991234567',city:'Казань',accent:'#16a34a',tg:'@test_company',max:'https://max.ru/test'}})
 assert.equal(r.statusCode,200);id=r.body.item.id;assert.match(id,/-[a-f0-9]{20}$/)
})
test('list returns pagination and server counters',async()=>{
 const r=await act({action:'list'});assert.equal(r.body.total,1);assert.equal(r.body.items[0].name,'Чистый дом');assert.equal(r.body.nextOffset,null)
})
test('preview customizes public fields, never exposes notes',async()=>{
 await act({action:'save',prospect:{...(await act({action:'list'})).body.items[0],notes:'private notes'}})
 const r=await request(preview,{method:'GET',query:{slug:id,own:'1'}})
 assert.equal(r.statusCode,200);assert(!r.body.includes('private notes'))
 const context={window:{SITE:structuredClone(site)}};vm.runInNewContext(r.body,context)
 assert.equal(context.window.SITE.brand.name,'Чистый дом');assert.equal(context.window.SITE.site.demo,true)
})
test('missing preview has explicit unavailable page',async()=>assert.match((await request(preview,{method:'GET',query:{slug:'missing-company'}})).body,/__PREVIEW_MISSING__/))
test('main demo does not forward or store contact details',async()=>{
 const r=await request(lead,{body:submit});assert.equal(r.body.demo,true);assert.equal(r.body.total,3500);assert.equal(svc.messages.length,0);assert(![...svc.data.keys()].some(k=>k.startsWith('lead:')))
})
test('preview demo works without Telegram and increments test count',async()=>{
 const old=process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_BOT_TOKEN
 const r=await request(lead,{body:{...submit,preview:id}});process.env.TELEGRAM_BOT_TOKEN=old
 assert.equal(r.body.demo,true);assert.equal(svc.redis(['HGETALL','pvleads'])[1],'1')
})
test('server rejects absent consent, phone, service, area and unknown extras',async()=>{
 for(const patch of [{consent:false},{phone:'123'},{service:'unknown'},{area:999},{area:50.2},{extras:['bad']}]) assert.equal((await request(lead,{body:{...submit,...patch}})).statusCode,400,JSON.stringify(patch))
})
test('date rejects rollover and past dates',async()=>{
 for(const date of ['2020-01-01','2027-02-30']) assert.equal((await request(lead,{body:{...submit,date}})).statusCode,400)
})
test('prices recalculated and extra titles deduplicated',()=>{
 assert.equal(estimate(site.pricing,{...submit,total:1}).total,3500)
 assert.equal(estimate(site.pricing,{...submit,service:'deep',area:80,extras:['Окна','Окна']}).total,11600)
})
test('production delivery stores consent and server-calculated price',async()=>{
 site.site.demo=false
 const r=await request(lead,{body:{...submit,total:1}});site.site.demo=true
 assert.equal(r.statusCode,200);assert.equal(r.body.total,3500);assert.equal(svc.messages.length,1)
 const saved=JSON.parse(svc.data.get('lead:'+r.body.id));assert.equal(saved.consent.accepted,true);assert.equal(saved.total,3500)
})
test('public demo requests do not mark offer as sent',async()=>{
 let r=await act({action:'log',id,channel:'wa'});assert.equal(r.body.item.status,'new');assert.equal(r.body.item.history.at(-1).type,'prepared')
 r=await act({action:'log',id,channel:'wa',confirmed:true});assert.equal(r.body.item.status,'sent')
})
test('webhook refuses missing or wrong secret',async()=>{
 assert.equal((await request(telegram)).statusCode,401)
 const old=process.env.TELEGRAM_WEBHOOK_SECRET;delete process.env.TELEGRAM_WEBHOOK_SECRET
 assert.equal((await request(telegram)).statusCode,503);process.env.TELEGRAM_WEBHOOK_SECRET=old
})
test('Redis HTTP errors fail closed',async()=>{
 globalThis.fetch=async()=>new Response('{}',{status:503});await assert.rejects(redis('GET','x'),/Redis unavailable/);globalThis.fetch=svc.fetch
})
test('admin login is rate limited',async()=>{
 let r;for(let i=0;i<11;i++)r=await act({action:'login',password:'wrong'},{'x-forwarded-for':'198.51.100.42'});assert.equal(r.statusCode,429)
})
test('list paginates more than 100 leads',async()=>{
 for(let i=0;i<105;i++)await act({action:'save',prospect:{name:'Тест '+i}})
 const a=await act({action:'list'}),b=await act({action:'list',offset:a.body.nextOffset})
 assert.equal(a.body.items.length,100);assert.equal(a.body.total,106);assert.equal(b.body.items.length,6)
})
test('search scans companies beyond first 100 and filters status',async()=>{
 const r=await act({action:'list',query:'Тест 0'});assert.equal(r.body.items.length,1);assert.equal(r.body.items[0].name,'Тест 0');assert.equal(r.body.nextOffset,null)
 const staged=await act({action:'list',stage:'sent'});assert.equal(staged.body.items.length,1);assert.equal(staged.body.items[0].id,id)
})
test('setup accepts only POST with a valid secret and configured HTTPS origin',async()=>{
 const {default:setup}=await import('../api/setup.js')
 assert.equal((await request(setup,{method:'GET'})).statusCode,405)
 assert.equal((await request(setup)).statusCode,401)
 process.env.PUBLIC_SITE_URL='https://demo.test'
 const r=await request(setup,{headers:{authorization:'Bearer '+process.env.TELEGRAM_WEBHOOK_SECRET}})
 assert.equal(r.body.ok,true)
})
test('logout clears session cookie' ,async()=>assert.match((await act({action:'logout'})).headers['set-cookie'],/Max-Age=0/))
test('delete removes public preview',async()=>{
 assert.equal((await act({action:'delete',id})).statusCode,200)
 assert.match((await request(preview,{method:'GET',query:{slug:id}})).body,/__PREVIEW_MISSING__/)
})
test('inline scripts parse as JavaScript',()=>{
 for(const name of ['index.html','admin.html','privacy.html']){
 const html=readFileSync(new URL('../'+name,import.meta.url),'utf8')
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi))new vm.Script(match[1],{filename:name})
 }
})
