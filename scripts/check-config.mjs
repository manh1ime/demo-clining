import {site} from '../api/_config.js'
const errors=[]
for(const [key,value] of Object.entries({...site.contacts,...site.legal,name:site.brand.name,city:site.city,url:site.site.url})){
 if(typeof value==='string' && (/\[[^\]]+\]|example\.com|000000/.test(value)))errors.push('Замените заглушку: '+key)
}
if(!/^https:\/\//.test(site.site.url))errors.push('site.url должен начинаться с https://')
for(const [k,n] of Object.entries(site.pricing.rates))if(!Number.isFinite(n)||n<=0)errors.push('Некорректный тариф '+k)
if(!Number.isFinite(site.pricing.minOrder)||site.pricing.minOrder<0)errors.push('Некорректный минимальный заказ')
console.log(site.site.demo===false?'Режим: реальные заявки':'Режим: демонстрация (контакты не отправляются)')
if(errors.length){console.log(errors.join('\n'));process.exitCode=1}else console.log('Настройки заполнены. Юридические тексты и внешние сервисы всё равно нужно проверить вручную.')
