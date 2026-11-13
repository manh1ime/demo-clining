// Run with environment variables; never put tokens in a command URL.
const origin=process.env.PUBLIC_SITE_URL
const secret=process.env.TELEGRAM_WEBHOOK_SECRET
if(!origin || !secret)throw new Error('Set PUBLIC_SITE_URL and TELEGRAM_WEBHOOK_SECRET')
const r=await fetch(new URL('/api/setup',origin),{method:'POST',headers:{Authorization:'Bearer '+secret}})
console.log(r.status,await r.json())
if(!r.ok)process.exitCode=1
