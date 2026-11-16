/* Progressive enhancement: the calculator and real model posters do not depend on WebGL or a CDN. */
(() => {
 'use strict'
 if(window.__PREVIEW_MISSING__)return
 const $=s=>document.querySelector(s),host=$('#kitWebgl'),poster=$('#kitPoster'),status=$('#kitMode'),button=$('#motion'),reduced=matchMedia('(prefers-reduced-motion: reduce)'),desktop=matchMedia('(min-width: 961px) and (pointer: fine)')
 const connection=navigator.connection,saveData=connection?.saveData===true||/^(slow-)?2g$/.test(connection?.effectiveType||'')
 let studio=null,pending=false,failed=false,inView=false,paused=reduced.matches,frameId=0,lost=false,generation=0
 function paintPause(){document.body.classList.toggle('paused',paused);if(!button)return;button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'Включить анимации':'Остановить анимации');button.textContent=paused?'▷':'Ⅱ'}
 paintPause()
 button?.addEventListener('click',()=>{paused=!paused;paintPause();if(studio){studio.reset();apply(true)}})
 reduced.addEventListener('change',()=>{paused=reduced.matches;paintPause();apply(true)})
 addEventListener('scroll',()=>{const max=document.documentElement.scrollHeight-innerHeight;const p=$('#progress');if(p)p.style.width=(max>0?scrollY/max*100:0)+'%'},{passive:true})
 // Content is visible by default; a failed script never hides sections.
 function current(){return KitLogic.select($('[data-type].active')?.dataset.type||'regular',[...document.querySelectorAll('#extras input:checked')].map(x=>x.dataset.title))}
 function posterMode(message){poster.hidden=false;if(host)host.style.visibility='hidden';if(status)status.textContent=message;window.sceneStatus=message==='3D недоступно · показано изображение'?'fallback':'poster'}
 function draw(){cancelAnimationFrame(frameId);if(!studio||lost||document.hidden||!inView)return;const moving=studio.render(paused||reduced.matches);if(moving&&!paused&&!reduced.matches)frameId=requestAnimationFrame(draw)}
 function wake(){if(!frameId)frameId=requestAnimationFrame(()=>{frameId=0;draw()});else{cancelAnimationFrame(frameId);frameId=requestAnimationFrame(()=>{frameId=0;draw()})}}
 function apply(immediate=false){
  const s=current();window.cleaningKitState=s
  const source='/assets/kit/'+s.key+'.svg';if(poster&&poster.getAttribute('src')!==source)poster.src=source
  if(poster)poster.alt='Иллюстрация набора: '+s.labels.join(', ')
  const title=$('#kitTitle');if(title)title.textContent=s.title
  const list=$('#kitItems');if(list)list.replaceChildren(...s.labels.map(text=>{const li=document.createElement('li');li.textContent=text;return li}))
  if(studio&&!lost){studio.setSelection(s.names,{immediate:immediate||paused||reduced.matches});wake()}
 }
 // Observe the existing calculator; never intercept its price or submission handlers.
 document.querySelectorAll('[data-type],[data-service]').forEach(b=>b.addEventListener('click',()=>apply()))
 $('#extras')?.addEventListener('change',()=>apply())
 $('#bookingForm')?.addEventListener('reset',()=>setTimeout(()=>apply(true),0))
 function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.crossOrigin='anonymous';const timer=setTimeout(()=>{el.remove();reject(new Error('CDN timeout'))},10000);el.onload=()=>{clearTimeout(timer);resolve()};el.onerror=()=>{clearTimeout(timer);reject(new Error('CDN unavailable'))};document.head.append(el)})}
 function eligible(){return desktop.matches&&!saveData}
 async function enable(){
  if(!host||!inView||!eligible()||studio||pending||failed)return
  pending=true;const ticket=++generation;status.textContent='Изображение набора · загрузка 3D'
  let instance=null,timer
  try{
   if(!window.THREE)await script('https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js')
   if(!window.THREE.GLTFLoader)await script('https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/loaders/GLTFLoader.js')
   if(!eligible()||ticket!==generation){pending=false;return}
   const creation=PremiumStudio.create({host,accent:window.SITE?.brand?.accent||'#8c9f8c',brand:window.SITE?.brand?.bottleName||window.SITE?.brand?.name||''})
   let timedOut=false
   instance=await Promise.race([creation,new Promise((_,reject)=>{timer=setTimeout(()=>{timedOut=true;reject(new Error('Model timeout'))},18000)})]).catch(error=>{creation.then(late=>{if(timedOut)late.dispose()},()=>{});throw error})
   clearTimeout(timer)
   if(!eligible()||ticket!==generation){instance.dispose();return}
   studio=instance;apply(true);studio.render(true);poster.hidden=true;host.style.visibility='visible';status.textContent='3D · лёгкий наклон вслед за мышью';window.sceneStatus='webgl'
   const canvas=studio.renderer.domElement
   canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(frameId);posterMode('3D недоступно · показано изображение')})
   canvas.addEventListener('webglcontextrestored',()=>{lost=false;apply(true);studio.render(true);poster.hidden=true;host.style.visibility='visible';window.sceneStatus='webgl';status.textContent='3D · лёгкий наклон вслед за мышью';wake()})
  }catch(error){clearTimeout(timer);failed=true;posterMode('3D недоступно · показано изображение');console.warn('Набор показан изображением:',error.message)}finally{pending=false}
 }
 function mode(){
  if(!eligible()){
   generation++;if(studio){cancelAnimationFrame(frameId);frameId=0;studio.dispose();studio=null}lost=false
   posterMode('Лёгкая версия · без загрузки 3D')
  }else if(studio){studio.resize();wake()}else {posterMode('Изображение набора');enable()}
 }
 host?.addEventListener('pointermove',e=>{if(!studio||paused||reduced.matches||e.pointerType==='touch')return;const r=host.getBoundingClientRect();studio.tilt(((e.clientX-r.left)/r.width-.5)*2,((e.clientY-r.top)/r.height-.5)*2);wake()})
 host?.addEventListener('pointerleave',()=>{studio?.reset();wake()})
 if(host&&window.ResizeObserver)new ResizeObserver(()=>{if(studio){studio.resize();wake()}}).observe(host)
 desktop.addEventListener('change',mode)
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAnimationFrame(frameId);else wake()})
 if(host&&window.IntersectionObserver){new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(inView){enable();wake()}else{cancelAnimationFrame(frameId);frameId=0}},{rootMargin:'200px'}).observe(host)}
 else {inView=true}
 apply(true);mode()
})()
