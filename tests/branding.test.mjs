import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {services, request} from './helpers.mjs'
const root = new URL('../', import.meta.url)
const source = readFileSync(new URL('brand-fit.js', root), 'utf8'), context = {window:{}}
vm.runInNewContext(source, context)
const ctx = {font:'',measureText(text){return {width:Array.from(text).length * parseFloat(this.font.split(' ')[1]) * .72}}}
for(const text of ['ЧИСТО','Архитектура безупречной чистоты Санкт-Петербурга','Ш'.repeat(80),'Клининговая компания «Чистый дом и уют» — Санкт-Петербург']) {
 test('label preserves and fits full text: '+text.slice(0,24),()=>{
  const layout = context.window.BrandText.fit(ctx,text,{width:840,height:650,maxFont:170,minFont:36,maxLines:7})
  ctx.font='650 '+layout.size+'px Arial'
  assert.equal(layout.lines.join('').replace(/\s/g,''),text.replace(/\s/g,''))
  assert(layout.lines.length<=7);assert(layout.lines.length*layout.lineHeight<=650)
  for(const line of layout.lines)assert(ctx.measureText(line).width<=840)
 })
}
test('embedded model has valid accessor ranges, all meshes and textures',()=>{
 const g=JSON.parse(JSON.parse(readFileSync(new URL('assets/kit-model/manifest.json',root),'utf8')).parts.map(p=>readFileSync(new URL(p.slice(1),root),'utf8')).join(''))
 const buffer=Buffer.from(g.buffers[0].uri.split(',')[1],'base64')
 assert.equal(buffer.length,g.buffers[0].byteLength);assert.equal(g.meshes.length,26)
 const bytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}
 for(const a of g.accessors){const v=g.bufferViews[a.bufferView];assert(v);assert(v.byteOffset+v.byteLength<=buffer.length);const element=bytes[a.componentType]*size[a.type];assert((a.byteOffset||0)+(a.count-1)*(v.byteStride||element)+element<=v.byteLength)}
 assert.equal(g.meshes.reduce((n,m)=>n+m.primitives.reduce((n,p)=>n+g.accessors[p.indices].count/3,0),0),52506)
 assert(g.materials.some(m=>m.name==='LabelSurface'));assert(g.materials.some(m=>m.name==='BrandAccent'))
 for(const image of g.images)assert(image.uri.startsWith('data:image/png;base64,'))
})
process.env.NODE_ENV='test';process.env.ADMIN_PASSWORD='local-brand-test';process.env.KV_REST_API_URL='https://redis.test';process.env.KV_REST_API_TOKEN='test'
const svc=services();globalThis.fetch=svc.fetch
const {default:admin}=await import('../api/admin.js'),{default:preview}=await import('../api/preview.js')
test('CRM and preview preserve an 80-character name and label',async()=>{
 const login=await request(admin,{body:{action:'login',password:process.env.ADMIN_PASSWORD}})
 const cookie=login.headers['set-cookie'].split(';')[0],name='ДлинноеНазваниеКомпании'.repeat(4).slice(0,80)
 const saved=await request(admin,{headers:{cookie},body:{action:'save',prospect:{name,logoText:name,bottleName:name}}})
 assert.equal(saved.statusCode,200);assert.equal(saved.body.item.logoText,name);assert.equal(saved.body.item.bottleName,name)
 const res=await request(preview,{method:'GET',query:{slug:saved.body.item.id,own:'1'}})
 const c={window:{SITE:{}}};vm.runInNewContext(res.body,c);assert.equal(c.window.SITE.brand.bottleName,name);assert.equal(c.window.SITE.brand.logoText,name)
})
test('missing custom bottle text uses the whole company name',async()=>{
 const login=await request(admin,{body:{action:'login',password:process.env.ADMIN_PASSWORD}}),cookie=login.headers['set-cookie'].split(';')[0]
 const name='Архитектура безупречной чистоты Санкт-Петербурга'
 const saved=await request(admin,{headers:{cookie},body:{action:'save',prospect:{name}}})
 const res=await request(preview,{method:'GET',query:{slug:saved.body.item.id,own:'1'}}),c={window:{SITE:{}}};vm.runInNewContext(res.body,c)
 assert.equal(c.window.SITE.brand.bottleName,name)
})
