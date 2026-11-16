/* Shared selection rules. No prices, order state or customer data are changed here. */
(() => {
  'use strict'
  const items = Object.freeze({Caddy:'Органайзер',UniversalSpray:'Универсальный спрей',Microfiber:'Микрофибра',DetailBrush:'Щётка',WindowSqueegee:'Скребок для стёкол',DegreaserBottle:'Обезжириватель',Sponge:'Губка',CompactVacuum:'Компактный пылесос'})
  const titles = {regular:'Для повседневной чистоты',deep:'Внимание к каждой детали',renovation:'Когда ремонт уже позади'}
  function select(type='regular', extras=[]) {
    if (!Object.hasOwn(titles,type)) type='regular'
    const kitchen=extras.some(x=>/духов|холодиль|кухн/iu.test(String(x)))
    const windows=extras.some(x=>/окн|ст[её]кл/iu.test(String(x)))
    const names=['Caddy','UniversalSpray','Microfiber']
    if(type!=='regular') names.push('DetailBrush','Sponge')
    if(type==='renovation') names.push('CompactVacuum')
    if(kitchen) names.push('DegreaserBottle','Sponge')
    if(windows) names.push('WindowSqueegee')
    const selected=[...new Set(names)]
    return {type,kitchen,windows,key:`${type}-${Number(kitchen)}${Number(windows)}`,title:titles[type],names:selected,labels:selected.map(x=>items[x])}
  }
  const api=Object.freeze({items,select})
  if(typeof window!=='undefined') window.KitLogic=api
  if(typeof module!=='undefined') module.exports=api
})()
