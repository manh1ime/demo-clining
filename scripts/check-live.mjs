// Read-only readiness check against YOUR deployed site. Does not submit an order.
// Run locally: node --env-file=.env.setup scripts/check-live.mjs
const url=process.env.PUBLIC_SITE_URL
const secret=process.env.TELEGRAM_WEBHOOK_SECRET
if(!url||!secret){console.error('Set PUBLIC_SITE_URL and TELEGRAM_WEBHOOK_SECRET in local .env.setup (never commit it).');process.exit(1)}
const target=new URL(url);if(target.protocol!=='https:'||target.username||target.password||target.pathname!=='/'||target.search||target.hash)throw new Error('PUBLIC_SITE_URL must be an HTTPS origin')
try{
 const response=await fetch(target.origin+'/api/setup',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret},body:JSON.stringify({action:'check'}),signal:AbortSignal.timeout(20000)})
 const data=await response.json()
 if(!response.ok){console.error('Readiness check failed, HTTP',response.status);process.exit(1)}
 // Print only non-secret diagnostics, never the environment, headers or token.
 console.log(JSON.stringify(data,null,2))
 if(!data.database||!data.managerChat||!data.webhookMatches||!data.liveTestEnabled||!data.adminEnabled)process.exitCode=1
}catch{console.error('Could not reach the deployed readiness check. Check domain, deployment and connection.');process.exitCode=1}
