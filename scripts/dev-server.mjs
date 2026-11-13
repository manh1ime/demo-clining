// Local integration harness. Data is temporary; Telegram and Redis are mocked.
import http from 'node:http'
import {readFile} from 'node:fs/promises'
import {resolve,extname,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {services} from '../tests/helpers.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
process.env.NODE_ENV='test'
process.env.ADMIN_PASSWORD='local-demo-password'
process.env.KV_REST_API_URL='https://redis.test'
process.env.KV_REST_API_TOKEN='local-test'
const svc=services();globalThis.fetch=svc.fetch
const api={};for(const name of ['admin','lead','preview','telegram','setup'])api[name]=(await import('../api/'+name+'.js')).default
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'}
http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,'http://localhost:4173');req.query=Object.fromEntries(url.searchParams)
 const endpoint=url.pathname.match(/^\/api\/(\w+)$/)?.[1]
 if(endpoint&&api[endpoint]){
 let body='';for await(const c of req){body+=c;if(body.length>100000){res.writeHead(413);res.end();return}}
 try{req.body=JSON.parse(body||'{}')}catch{req.body={}}
 res.status=n=>{res.statusCode=n;return res};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return res};res.send=v=>{res.end(String(v));return res}
 await api[endpoint](req,res);return
 }
 let path=url.pathname
 if(path==='/admin')path='/admin.html'
 else if(/^\/p\/[a-z0-9-]+\/privacy\/?$/.test(path))path='/privacy.html'
 else if(path==='/'||/^\/p\/[a-z0-9-]+\/?$/.test(path))path='/index.html'
 // Deliberately serve only public assets, never APIs, tests, docs or .env files.
 if(!['/index.html','/admin.html','/privacy.html','/404.html','/config.js','/site.js','/favicon.svg','/robots.txt','/sitemap.xml'].includes(path)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(root+'/404.html'));return}
 res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(root+path))
 }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end('Local test error')}
}).listen(4173,'127.0.0.1',()=>console.log('Local demo http://localhost:4173 | admin password: local-demo-password | mock services, no persistent data'))
