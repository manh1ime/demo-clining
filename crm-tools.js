(function(root){
'use strict';
const GROUPS={new_site:'1 · Новый сайт / первая квалификация',existing_site:'2 · Сайт есть / интеграция',qualify:'3 · Уточнить профиль',fix:'4 · Точечная доработка',reserve:'5 · Резерв текущего продукта'};
const phone=v=>{const d=String(v||'').replace(/\D/g,'');return d.length===11&&d[0]==='8'?'7'+d.slice(1):d};
const firmId=p=>String(p.sourceFirmId||'').match(/^\d{15,17}$/)?.[0]||String(p.links||'').match(/2gis\.ru\/[^\s]*?firm\/(\d{15,17})/)?.[1]||'';
const sourceUrl=p=>{const id=firmId(p||{});return id?'https://2gis.ru/spb/firm/'+id:''};
const vkChat=value=>{try{const u=new URL(value);if(!['vk.ru','vk.com','www.vk.ru','www.vk.com','vk.me'].includes(u.hostname)||u.protocol!=='https:'||u.username||u.password)return '';const part=u.pathname.split('/').filter(Boolean)[0];return /^[a-zA-Z0-9_.-]+$/.test(part||'')?'https://vk.me/'+part:''}catch{return ''}};
function validateImport(data){
 const rows=Array.isArray(data)?data:data?.prospects;
 if(!Array.isArray(rows)||!rows.length||rows.length>500)throw new Error('Нужен JSON со списком от 1 до 500 компаний');
 const ids=new Set();return rows.map(p=>{if(!p||typeof p!=='object'||Array.isArray(p)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw new Error('Некорректное название компании');const id=firmId(p);if(!id||ids.has(id))throw new Error('Отсутствует или повторяется источник 2ГИС');if(!Object.hasOwn(GROUPS,p.group))throw new Error('Неизвестная группа');ids.add(id);return {...p,sourceFirmId:id,status:'new'};});
}
function matchImport(p,existing){
 const id=firmId(p),direct=existing.filter(x=>firmId(x)===id);
 if(direct.length>1)return {conflict:'В CRM уже несколько карточек с этим источником'};
 if(direct.length===1)return {item:direct[0]};
 const normalizedName=v=>String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]/g,'');
 const similar=existing.filter(x=>(!firmId(x)&&normalizedName(x.name)===normalizedName(p.name))||(phone(p.phone).length>=10&&[x.phone,x.wa].some(v=>phone(v)===phone(p.phone))));
 // No fuzzy automatic merges. User reviews ambiguities instead of overwriting another firm.
 if(similar.length)return {conflict:'Совпало название или телефон без совпадения источника. Проверьте вручную.'};
 return {};
}
root.CRMTools={GROUPS,phone,firmId,sourceUrl,vkChat,validateImport,matchImport};
})(typeof window!=='undefined'?window:globalThis);
