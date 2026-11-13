// In-memory service doubles. Never connects to live Telegram or Redis.
export function services() {
  const data=new Map(), expiry=new Map(), messages=[]
  function redis(cmd) {
    const [op,...a]=cmd.map(String), key=a[0]
    if(expiry.has(key)&&expiry.get(key)<Date.now()){data.delete(key);expiry.delete(key)}
    const value=()=>data.get(key)
    switch(op.toUpperCase()){
      case 'INCR': {const n=Number(value()||0)+1;data.set(key,String(n));return n}
      case 'EXPIRE': expiry.set(key,Date.now()+Number(a[1])*1000);return 1
      case 'GET': return value()??null
      case 'SET': if(a.includes('NX')&&data.has(key))return null;data.set(key,a[1]);return 'OK'
      case 'DEL': return Number(data.delete(key))
      case 'MGET': return a.map(k=>data.get(k)??null)
      case 'ZADD': {const m=value()||new Map();m.set(a[2],Number(a[1]));data.set(key,m);return 1}
      case 'ZCARD': return value()?.size||0
      case 'ZREM': return Number(value()?.delete(a[1])||0)
      case 'ZRANGE': case 'ZREVRANGE': {let list=[...(value()||new Map())].sort((a,b)=>a[1]-b[1]);if(op==='ZREVRANGE')list.reverse();return list.slice(Number(a[1]),Number(a[2])===-1?undefined:Number(a[2])+1).map(x=>x[0])}
      case 'HINCRBY': {const m=value()||new Map(), n=Number(m.get(a[1])||0)+Number(a[2]);m.set(a[1],String(n));data.set(key,m);return n}
      case 'HSET': {const m=value()||new Map();m.set(a[1],a[2]);data.set(key,m);return 1}
      case 'HDEL': return Number(value()?.delete(a[1])||0)
      case 'HGETALL': return [...(value()||new Map())].flat()
      default: throw new Error('Unsupported test command '+op)
    }
  }
  const fetch=async(url,options={})=>{
    if(String(url)==='https://redis.test') return Response.json({result:redis(JSON.parse(options.body))})
    if(String(url).startsWith('https://api.telegram.org/')){const body=JSON.parse(options.body);messages.push(body);return Response.json({ok:true,result:{message_id:messages.length,url:'https://demo.test/api/telegram'}})}
    throw new Error('Unexpected network request: '+url)
  }
  return {data,expiry,messages,redis,fetch}
}
export function request(handler,{body={},method='POST',headers={},query={}}={}) {
  const req={method,body,query,headers:{host:'localhost:4173','x-requested-with':'cleaning-admin','x-forwarded-for':'127.0.0.1',...headers}}
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}}
  return Promise.resolve(handler(req,res)).then(()=>res)
}
