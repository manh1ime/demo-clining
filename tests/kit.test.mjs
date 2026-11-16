import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'
import vm from 'node:vm'
const root=new URL('../',import.meta.url),sandbox={window:{}}
vm.runInNewContext(readFileSync(new URL('kit-logic.js',root),'utf8'),sandbox)
const K=sandbox.window.KitLogic,g=JSON.parse(JSON.parse(readFileSync(new URL('assets/kit-model/manifest.json',root),'utf8')).parts.map(p=>readFileSync(new URL(p.slice(1),root),'utf8')).join(''))
for(const type of ['regular','deep','renovation'])for(let mask=0;mask<16;mask++){
 const extras=['Окна','Духовка','Холодильник','Балкон'].filter((_,i)=>mask&(1<<i))
 test(`kit ${type}, extras mask ${mask}`,()=>{const s=K.select(type,extras);assert.equal(s.names.length,new Set(s.names).size);for(const name of s.names)assert(g.nodes.some(n=>n.name===name));assert(s.names.includes('WindowSqueegee')===extras.includes('Окна'));assert(s.names.includes('CompactVacuum')===(type==='renovation'));assert(s.names.includes('DegreaserBottle')===(extras.includes('Духовка')||extras.includes('Холодильник')));assert(existsSync(new URL('assets/kit/'+s.key+'.svg',root)))})
}
test('unknown service has a safe regular fallback',()=>assert.equal(K.select('unknown').type,'regular'))
test('all eight independent roots are present',()=>{const names=g.scenes[g.scene||0].nodes.map(i=>g.nodes[i].name);assert.deepEqual([...names].sort(),Object.keys(K.items).sort())})
test('new scene never changes price calculation or submits leads',()=>{const s=readFileSync(new URL('caddy-scene.js',root),'utf8');assert(!s.includes('/api/lead'));assert(!s.includes("$('#price')"));assert(!s.includes('localStorage'))})
test('mobile does not load eager third-party 3D scripts',()=>{const s=readFileSync(new URL('index.html',root),'utf8');assert(!/<script[^>]*src="https:\/\/cdn/.test(s));assert(s.includes('/assets/kit/all.svg'));assert(s.includes('id="kitPoster"'))})
