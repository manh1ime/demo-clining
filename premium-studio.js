/* Studio presentation for the supplied collection. Three.js and GLTFLoader are loaded from CDN by the caller. */
(() => {
 'use strict'
 async function create({host,modelUrl='/assets/kit-model/manifest.json',accent='#8c9f8c',brand='',shadows=true}) {
  const T=window.THREE
  if(!T?.GLTFLoader) throw new Error('3D library unavailable')
  const renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:false})
  renderer.setClearColor(0,0); renderer.outputEncoding=T.sRGBEncoding
  renderer.toneMapping=T.ACESFilmicToneMapping; renderer.toneMappingExposure=1.05
  renderer.physicallyCorrectLights=true; renderer.shadowMap.enabled=shadows; renderer.shadowMap.type=T.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-hidden','true'); host.append(renderer.domElement)
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(31,1,.01,10)
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512
  const ctx=canvas.getContext('2d'),g=ctx.createLinearGradient(0,0,0,512)
  g.addColorStop(0,'#e6e9e4');g.addColorStop(.38,'#fffdf7');g.addColorStop(.65,'#d1d5cc');g.addColorStop(1,'#8f968e');ctx.fillStyle=g;ctx.fillRect(0,0,1024,512)
  ctx.fillStyle='#ffffff';ctx.fillRect(110,35,170,270);ctx.fillStyle='#f8f5eb';ctx.fillRect(620,90,300,100)
  const env=new T.CanvasTexture(canvas);env.encoding=T.sRGBEncoding;env.mapping=T.EquirectangularReflectionMapping
  const pmrem=new T.PMREMGenerator(renderer),environment=pmrem.fromEquirectangular(env);scene.environment=environment.texture;pmrem.dispose();env.dispose()
  scene.add(new T.HemisphereLight(0xfffdf5,0xb1b9ad,.9))
  const key=new T.DirectionalLight(0xfff9ee,3.2);key.position.set(-.65,1.1,1.3);key.castShadow=shadows
  key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-.65,right:.65,top:.65,bottom:-.65,near:.1,far:4});key.shadow.bias=-.00015;key.shadow.normalBias=.0004;key.shadow.radius=4;scene.add(key)
  const fill=new T.DirectionalLight(0xe5efff,1.1);fill.position.set(.9,.45,-.2);scene.add(fill)
  const floor=new T.Mesh(new T.PlaneGeometry(6,6),new T.ShadowMaterial({color:0x000000,opacity:.4}));floor.rotation.x=-Math.PI/2;floor.position.y=-.001;floor.receiveShadow=true;scene.add(floor)
  const world=new T.Group();scene.add(world)
  let gltf
  try {
   const loader=new T.GLTFLoader()
   if(modelUrl.endsWith('.gltf')) gltf=await new Promise((resolve,reject)=>loader.load(modelUrl,resolve,undefined,reject))
   else {
    const manifestResponse=await fetch(modelUrl);if(!manifestResponse.ok)throw new Error('Model manifest unavailable')
    const manifest=await manifestResponse.json();if(manifest.format!=='gltf-chunks-v1'||!Array.isArray(manifest.parts)||manifest.parts.length>20)throw new Error('Invalid model manifest')
    const pieces=await Promise.all(manifest.parts.map(async url=>{if(!/^\/assets\/kit-model\/part-\d{2}\.txt$/.test(url))throw new Error('Invalid model part');const response=await fetch(url);if(!response.ok)throw new Error('Model part unavailable');return response.text()}))
    gltf=await new Promise((resolve,reject)=>loader.parse(pieces.join(''),'/assets/',resolve,reject))
   }
  }
  catch(error){renderer.domElement.remove();renderer.dispose();environment.dispose();throw error}
  const model=gltf.scene;world.add(model)
  const roots={};model.children.forEach(x=>{roots[x.name]=x;x.userData.baseScale=x.scale.clone();x.userData.amount=1;x.userData.target=1})
  const labelCanvas=document.createElement('canvas');labelCanvas.width=768;labelCanvas.height=1024
  const lc=labelCanvas.getContext('2d');lc.fillStyle='#f4f2eb';lc.fillRect(0,0,768,1024)
  lc.fillStyle=accent;lc.fillRect(350,140,68,7);lc.textAlign='center';lc.textBaseline='middle';lc.fillStyle='#303932'
  const text=String(brand||'УХОД ЗА ДОМОМ'),labelFit=window.BrandText?.fit(lc,text,{width:650,height:550,maxFont:110,minFont:26,maxLines:9})
  if(labelFit){lc.font=`600 ${labelFit.size}px Arial`;labelFit.lines.forEach((line,i)=>lc.fillText(line,384,490+(i-(labelFit.lines.length-1)/2)*labelFit.lineHeight))}
  else {lc.font='600 45px Arial';lc.fillText('УХОД ЗА ДОМОМ',384,480)}
  lc.fillStyle=accent;lc.fillRect(318,830,132,5)
  const label=new T.CanvasTexture(labelCanvas);label.encoding=T.sRGBEncoding;label.flipY=false
  const mats=new Set()
  model.traverse(o=>{
   if(!o.isMesh)return;o.castShadow=true;o.receiveShadow=true
   for(const m of (Array.isArray(o.material)?o.material:[o.material])) {
    if(mats.has(m))continue;mats.add(m);m.envMapIntensity=.55
    if(m.name==='BrandAccent'){m.color.set(accent);m.metalness=0;m.roughness=.65}
    if(m.name==='CharcoalRubber'){m.metalness=0;m.roughness=.63}
    if(m.name==='MicrofiberFabric'){m.metalness=0;m.roughness=.95}
    if(m.name==='IvoryBody'){m.metalness=0;m.roughness=.65}
    if(m.name==='SatinMetal'){m.metalness=.85;m.roughness=.34}
    if(m.name==='LabelSurface'){m.color.set(0xffffff);m.map=label;m.polygonOffset=true;m.polygonOffsetFactor=-2;m.polygonOffsetUnits=-2;m.needsUpdate=true}
   }
  })
  let names=Object.keys(roots),distance=1.2,targetDistance=1.2,focus=new T.Vector3(),targetFocus=new T.Vector3(),yaw=0,pitch=0,targetYaw=0,targetPitch=0,w=1,h=1
  const direction=new T.Vector3(.38,.5,1).normalize()
  function fit() {
   const box=new T.Box3()
   for(const name of names){const o=roots[name];if(!o)continue;const old=o.scale.clone();o.scale.copy(o.userData.baseScale);o.updateMatrixWorld(true);box.expandByObject(o);o.scale.copy(old);o.updateMatrixWorld(true)}
   if(box.isEmpty())return
   targetFocus.copy(box.getCenter(new T.Vector3()));targetFocus.y-=.004
   const right=new T.Vector3().crossVectors(camera.up,direction).normalize(),up=new T.Vector3().crossVectors(direction,right),tanV=Math.tan(T.MathUtils.degToRad(camera.fov/2)),tanH=tanV*w/h
   let d=0
   for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
    const p=new T.Vector3(x,y,z).sub(targetFocus);d=Math.max(d,Math.abs(p.dot(right))/tanH+p.dot(direction),Math.abs(p.dot(up))/tanV+p.dot(direction))
   }
   targetDistance=d*1.18
  }
  function resize() {
   w=host.clientWidth||900;h=host.clientHeight||600;renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();fit()
  }
  function setSelection(selected,{immediate=false}={}) {
   names=selected.filter(n=>roots[n]);Object.entries(roots).forEach(([name,o])=>{o.userData.target=names.includes(name)?1:0;if(immediate){o.userData.amount=o.userData.target;o.scale.copy(o.userData.baseScale).multiplyScalar(Math.max(.0001,o.userData.amount));o.visible=!!o.userData.target}})
   fit();if(immediate){distance=targetDistance;focus.copy(targetFocus);yaw=pitch=0;world.rotation.set(0,0,0)}
  }
  function reset(){targetYaw=0;targetPitch=0}
  function tilt(x,y){targetYaw=x*.10;targetPitch=y*.035}
  function render(snap=false) {
   let moving=false
   Object.values(roots).forEach(o=>{const u=o.userData,delta=u.target-u.amount;if(Math.abs(delta)>.001){u.amount=snap?u.target:u.amount+delta*.15;moving=true}else u.amount=u.target;o.visible=u.amount>.001;o.scale.copy(u.baseScale).multiplyScalar(Math.max(.0001,u.amount))})
   const lerp=snap?1:.12
   if(Math.abs(distance-targetDistance)>.0001||focus.distanceTo(targetFocus)>.0001||Math.abs(yaw-targetYaw)>.0001||Math.abs(pitch-targetPitch)>.0001)moving=true
   distance+=(targetDistance-distance)*lerp;focus.lerp(targetFocus,lerp);yaw+=(targetYaw-yaw)*lerp;pitch+=(targetPitch-pitch)*lerp
   world.rotation.set(pitch,yaw,0);camera.position.copy(direction).multiplyScalar(distance).add(focus);camera.lookAt(focus);renderer.render(scene,camera)
   return moving
  }
  function dispose(){renderer.dispose();environment.dispose();label.dispose();renderer.domElement.remove();model.traverse(o=>{if(o.isMesh)o.geometry.dispose()});mats.forEach(m=>m.dispose())}
  resize();setSelection(names,{immediate:true});render(true)
  return {renderer,scene,camera,roots,setSelection,resize,render,tilt,reset,dispose}
 }
 window.PremiumStudio={create}
})()
