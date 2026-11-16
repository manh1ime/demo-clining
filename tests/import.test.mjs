import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {services,request} from './helpers.mjs'
process.env.NODE_ENV='test';process.env.ADMIN_PASSWORD='fixture-password';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='fixture'
const svc=services();globalThis.fetch=svc.fetch
const {default:admin}=await import('../api/admin.js')
const {default:preview}=await import('../api/preview.js')
const box={URL};vm.runInNewContext(readFileSync(new URL('../crm-tools.js',import.meta.url),'utf8'),box);const tools=box.CRMTools
// Synthetic data only: no customer records are committed to the repository.
const rows=Array.from({length:100},(_,i)=>({name:'Организация '+i,sourceFirmId:String(70000002000000000n+BigInt(i)),group:i<12?'new_site':'qualify',priority:i<12?i+1:0,phone:'+7900'+String(i).padStart(7,'0'),links:'https://2gis.ru/spb/firm/'+String(70000002000000000n+BigInt(i)),notes:'private note '+i,nextAction:'private action',firstMessage:'private message'}))
let cookie,seed
const api=(body,headers={})=>request(admin,{body,headers:{cookie,...headers}})
test('bulk import requires authenticated same-origin session',async()=>{
 assert.equal((await api({action:'importOne',prospect:rows[0]})).statusCode,401)
 assert.equal((await api({action:'importOne',prospect:rows[0]},{origin:'https://evil.test'})).statusCode,403)
 const r=await api({action:'login',password:process.env.ADMIN_PASSWORD});cookie=r.headers['set-cookie'].split(';')[0]
})
test('import 100 synthetic prospects and repeat without duplicates',async()=>{
 seed=(await api({action:'save',prospect:{...rows[0],status:'interested',notes:'preserve this',regular:999}})).body.item
 for(let round=0;round<2;round++){
  for(const p of rows){const listed=(await api({action:'list'})).body.items;const match=tools.matchImport(p,listed);assert(!match.conflict);const r=await api({action:'importOne',prospect:p,existingId:match.item?.id});assert.equal(r.statusCode,200,JSON.stringify(r.body))}
  assert.equal((await api({action:'list'})).body.total,100)
 }
 const saved=(await api({action:'list'})).body.items.find(x=>x.id===seed.id)
 assert.equal(saved.notes,'preserve this');assert.equal(saved.status,'interested');assert.equal(saved.regular,999)
})
test('all 12 priority prospects filter server-side',async()=>assert.equal((await api({action:'list',group:'new_site'})).body.items.length,12))
test('source disagreement cannot overwrite existing company',async()=>assert.equal((await api({action:'importOne',existingId:seed.id,prospect:rows[1]})).statusCode,400))
test('missing source rejected',async()=>assert.equal((await api({action:'importOne',prospect:{name:'x'}})).statusCode,400))
test('import never puts private workflow in public demo',async()=>{
 const r=await request(preview,{method:'GET',query:{slug:seed.id,own:'1'}})
 for(const secret of ['private action','private message','preserve this','sourceFirmId'])assert(!r.body.includes(secret))
})
test('new imported public preview slugs are not enumerable source IDs',async()=>{
 const p=(await api({action:'list'})).body.items.find(x=>x.id!==seed.id);assert.match(p.id,/^imp-[a-f0-9]{40}$/)
})
test('2GIS source button works with canonical and search links',()=>{
 assert.equal(tools.sourceUrl(rows[0]),'https://2gis.ru/spb/firm/'+rows[0].sourceFirmId)
 assert.equal(tools.sourceUrl({links:'https://2gis.ru/spb/search/a/page/9/firm/70000002000000000?m=x'}),'https://2gis.ru/spb/firm/70000002000000000')
 assert.equal(tools.sourceUrl({links:'https://evil.test'}),'')
})
test('duplicate file sources rejected before writes',()=>assert.throws(()=>tools.validateImport({prospects:[rows[0],rows[0]]})))
test('unknown group rejected in upload validation',()=>assert.throws(()=>tools.validateImport({prospects:[{...rows[0],group:'bad'}]})))
test('different known sources can share a generic company name',()=>assert(!tools.matchImport({...rows[0],name:'Клининговая компания',phone:''},[{...rows[1],name:'Клининговая компания',phone:''}]).conflict))
test('ambiguous legacy phone does not cause silent merge',()=>assert(tools.matchImport(rows[0],[{name:'legacy',phone:rows[0].phone}]).conflict))
test('VK chat rejects foreign domains',()=>{assert.equal(tools.vkChat('https://vk.ru/example'),'https://vk.me/example');assert.equal(tools.vkChat('https://vk.ru.evil.test/example'),'')})
