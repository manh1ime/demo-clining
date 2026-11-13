import test from 'node:test'
import assert from 'node:assert/strict'
import {services,request} from './helpers.mjs'
process.env.NODE_ENV='test';process.env.ADMIN_PASSWORD='test-password';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test';process.env.TELEGRAM_WEBHOOK_SECRET='test-secret';process.env.TELEGRAM_BOT_TOKEN='test-token';process.env.TELEGRAM_CHAT_ID='100'
const svc=services();globalThis.fetch=svc.fetch
const {default:handler}=await import('../api/telegram.js');const {saveLead,getLead,mutateLead}=await import('../api/_lib.js');const {default:leadHandler}=await import('../api/lead.js');const {default:admin}=await import('../api/admin.js')
let seq=0;const user={id:1,first_name:'Менеджер'};const headers={'x-telegram-bot-api-secret-token':'test-secret'}
const fresh=async(id='1')=>saveLead({id,status:'new',name:'Тест',phone:'+70000000000',service:'Генеральная',area:80,total:11600,extras:['Окна'],isTest:true,createdAt:new Date().toISOString(),history:[],revision:0,messageId:1})
const callback=(data,from=user,extra={})=>request(handler,{headers,body:{update_id:++seq,callback_query:{id:'cb'+seq,data,from,message:{chat:{id:100},message_id:1}},...extra}})
const command=(text,from=user)=>request(handler,{headers,body:{update_id:++seq,message:{message_id:seq,text,from,chat:{id:100}}}})
const form={name:'Живой тест',phone:'+70000000000',consent:true,service:'deep',area:80,extras:['Окна'],liveTest:true}
test('live test opt-in defaults to denied',async()=>assert.equal((await request(leadHandler,{body:form})).statusCode,403))
test('live test requires login even when flag enabled',async()=>{process.env.LIVE_TEST_MODE='true';assert.equal((await request(leadHandler,{body:form})).statusCode,403)})
test('authenticated live test stores and notifies with TEST label; public demo stays safe',async()=>{
 const login=await request(admin,{body:{action:'login',password:process.env.ADMIN_PASSWORD}});const cookie=login.headers['set-cookie'].split(';')[0]
 const r=await request(leadHandler,{body:form,headers:{cookie}});assert.equal(r.statusCode,200);assert.equal(r.body.isTest,true);assert.equal(r.body.total,11600);assert.equal((await getLead(r.body.id)).isTest,true);assert.match(svc.messages.at(-1).text,/ЖИВОЙ ТЕСТ/)
 assert.equal((await request(leadHandler,{body:{...form,liveTest:false}})).body.demo,true)
 assert.equal((await request(leadHandler,{body:form,headers:{cookie,origin:'https://evil.test'}})).statusCode,403)
})
test('authorized user claims and gets named ownership',async()=>{await fresh();await callback('st:1:work');const l=await getLead('1');assert.equal(l.status,'work');assert.equal(l.assigneeId,'1')})
test('another manager cannot change an owned order',async()=>{await callback('st:1:called',{id:2,first_name:'Другой'});assert.equal((await getLead('1')).status,'work')})
test('closing requires confirmation; direct legacy status cannot bypass it',async()=>{await callback('st:1:done');await callback('cf:1:done');assert.equal((await getLead('1')).status,'work');assert.match(JSON.stringify(svc.messages.at(-2)),/ok:1:done/)})
test('notes, agreed price and schedule are saved with validation',async()=>{
 await command('/note 1 Адрес: учебный пример');await command('/price 1 12000');await command('/schedule 1 2099-02-30 10:00');assert.equal((await getLead('1')).scheduledAt,undefined)
 await command('/schedule 1 2099-12-01 10:00');const l=await getLead('1');assert.equal(l.status,'scheduled');assert.equal(l.finalPrice,12000);assert.equal(l.notes.length,1)
})
test('stale confirmation cannot overwrite newer details',async()=>{await callback('ok:1:done:1');assert.equal((await getLead('1')).status,'scheduled')})
test('confirmed completion removes from open index',async()=>{const l=await getLead('1');await callback('ok:1:done:'+l.revision);assert.equal((await getLead('1')).status,'done');assert(!svc.redis(['ZRANGE','leads:open',0,-1]).includes('1'))})
test('reopen and cancel with saved reason',async()=>{await callback('st:1:work');await command('/cancel 1 Клиент передумал');let l=await getLead('1');assert.equal(l.status,'work');await callback('ok:1:cancel:'+l.revision);l=await getLead('1');assert.equal(l.status,'cancel');assert.equal(l.cancelReason,'Клиент передумал')})
test('allowlist prevents unapproved user from claiming',async()=>{await fresh('2');process.env.TELEGRAM_MANAGER_IDS='1';await callback('st:2:work',{id:2});assert.equal((await getLead('2')).status,'new');delete process.env.TELEGRAM_MANAGER_IDS})
test('duplicate webhook and duplicate mutation do not duplicate history',async()=>{await fresh('3');const u={update_id:10000,callback_query:{id:'same',data:'st:3:work',from:user,message:{chat:{id:100},message_id:1}}};await request(handler,{headers,body:u});await request(handler,{headers,body:u});assert.equal((await getLead('3')).history.length,1)})
test('concurrent changes preserve both notes through CAS retries',async()=>{await fresh('4');await Promise.all(['a','b'].map(x=>mutateLead('4',l=>{l.notes ||= [];l.notes.push({text:x})})));assert.equal((await getLead('4')).notes.length,2)})
test('queue pagination and mine filter',async()=>{for(let i=10;i<25;i++)await fresh(String(i));await command('/leads');assert.match(JSON.stringify(svc.messages.at(-1)),/list:all:1/);await command('/mine');assert.match(svc.messages.at(-1).text,/Мои заявки/)})
test('temporary service failure returns 503 to request Telegram retry',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('test unavailable')};const r=await command('/leads');globalThis.fetch=old;assert.equal(r.statusCode,503)})
