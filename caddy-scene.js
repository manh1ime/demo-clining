/* User-supplied cleaning_caddy.glb, losslessly repackaged as embedded glTF. */
(() => {
  'use strict'
  if (window.__PREVIEW_MISSING__) return
  const host = document.getElementById('webgl'), fallback = document.getElementById('fallback')
  const note = document.getElementById('sceneNote'), hint = document.querySelector('.scene-label')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), button = document.getElementById('motion')
  let paused = reduced.matches, visible = true, lost = false, ready = false, failure = false
  function paintPause() {
    document.body.classList.toggle('paused', paused)
    button.setAttribute('aria-pressed', String(paused))
    button.setAttribute('aria-label', paused ? 'Включить анимации' : 'Остановить анимации')
    button.textContent = paused ? '▷' : 'Ⅱ'
  }
  paintPause(); button.addEventListener('click', () => { paused = !paused; paintPause() })
  reduced.addEventListener('change', e => { paused = e.matches; paintPause() })
  if (window.IntersectionObserver) {
    const reveal = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); reveal.unobserve(e.target) } }), { threshold: .08 })
    document.querySelectorAll('.reveal').forEach(el => reveal.observe(el)); document.body.classList.add('js-motion')
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting }).observe(host)
  }
  addEventListener('scroll', () => { const max = document.documentElement.scrollHeight - innerHeight; document.getElementById('progress').style.width = (max > 0 ? scrollY / max * 100 : 0) + '%' }, { passive: true })
  function showFallback(reason) {
    fallback.hidden = false; fallback.style.display = 'flex'; note.style.display = 'block'
    hint.textContent = 'Набор для уборки'; window.sceneStatus = reason || 'fallback'
  }
  // The actual model poster remains visible until the model AND all embedded textures are ready.
  window.sceneStatus = 'loading'
  if (!window.THREE || !THREE.GLTFLoader) { showFallback('fallback'); return }
  let renderer
  try {
    const T = THREE, scene = new T.Scene()
    T.ColorManagement.legacyMode = false
    renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setClearColor(0x000000, 0)
    renderer.outputEncoding = T.sRGBEncoding
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .98
    renderer.physicallyCorrectLights = true
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.5 : 2))
    renderer.domElement.style.visibility = 'hidden'; renderer.domElement.setAttribute('aria-hidden', 'true'); host.append(renderer.domElement)
    const camera = new T.PerspectiveCamera(32, 1, .01, 10)
    const env = document.createElement('canvas'); env.width = 512; env.height = 256
    const ec = env.getContext('2d'), gradient = ec.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#e3edf5'); gradient.addColorStop(.4, '#ffffff'); gradient.addColorStop(1, '#a3b5c2')
    ec.fillStyle = gradient; ec.fillRect(0, 0, 512, 256)
    const environment = new T.CanvasTexture(env); environment.encoding = T.sRGBEncoding; environment.mapping = T.EquirectangularReflectionMapping
    const pmrem = new T.PMREMGenerator(renderer), target = pmrem.fromEquirectangular(environment)
    scene.environment = target.texture; pmrem.dispose(); environment.dispose()
    scene.add(new T.HemisphereLight(0xffffff, 0xc0ccd5, .55))
    const key = new T.DirectionalLight(0xffffff, 2); key.position.set(-1, 2, 2); scene.add(key)
    const fill = new T.DirectionalLight(0xc7e4ff, .85); fill.position.set(2, 1, -1); scene.add(fill)
    const world = new T.Group(); scene.add(world)
    let targetX = 0, targetY = 0, rx = 0, ry = 0, fitBox
    const direction = new T.Vector3(.30, .18, 1).normalize(), right = new T.Vector3().crossVectors(camera.up, direction).normalize(), up = new T.Vector3().crossVectors(direction, right)
    function resize() {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.5 : 2)); renderer.setSize(w, h, false)
      camera.aspect = w / h
      let distance = .8
      if (fitBox) {
        const tanV = Math.tan(T.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect
        distance = 0
        for (const x of [fitBox.min.x, fitBox.max.x]) for (const y of [fitBox.min.y, fitBox.max.y]) for (const z of [fitBox.min.z, fitBox.max.z]) {
          const p = new T.Vector3(x, y, z)
          distance = Math.max(distance, Math.abs(p.dot(right)) / tanH + p.dot(direction), Math.abs(p.dot(up)) / tanV + p.dot(direction))
        }
        distance *= 1.23 // Room for pointer tilt; no clipping on tall/narrow screens.
      }
      camera.position.copy(direction).multiplyScalar(distance); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix()
    }
    new ResizeObserver(resize).observe(host); resize()
    host.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || innerWidth < 760) return
      const r = host.getBoundingClientRect(); targetX = ((e.clientX - r.left) / r.width - .5) * 2; targetY = ((e.clientY - r.top) / r.height - .5) * 2
    })
    host.addEventListener('pointerleave', () => { targetX = 0; targetY = 0 })
    renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; renderer.domElement.style.visibility = 'hidden'; showFallback('context-lost') })
    renderer.domElement.addEventListener('webglcontextrestored', () => { lost = false; if (ready) { renderer.domElement.style.visibility = 'visible'; fallback.style.display = 'none'; note.style.display = 'none'; window.sceneStatus = 'webgl'; hint.textContent = 'Набор для уборки' } })
    function labelTexture() {
      const brand = window.SITE?.brand || {}, canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1280
      const ctx = canvas.getContext('2d'), accent = brand.accent || '#2054ec'
      ctx.fillStyle = '#faf7ef'; ctx.fillRect(0, 0, 1024, 1280)
      ctx.fillStyle = accent; ctx.fillRect(478, 100, 68, 18); ctx.fillRect(503, 75, 18, 68)
      const text = String(brand.bottleName || brand.name || 'БРЕНД')
      const layout = BrandText.fit(ctx, text, { width: 840, height: 650, maxFont: 170, minFont: 36, maxLines: 7 })
      ctx.font = '650 ' + layout.size + 'px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#17333f'
      const start = 620 - (layout.lines.length - 1) * layout.lineHeight / 2
      layout.lines.forEach((line, i) => ctx.fillText(line, 512, start + i * layout.lineHeight))
      ctx.fillStyle = accent; ctx.fillRect(442, 1010, 140, 6)
      const subtitle = String(brand.bottleLine1 || 'УХОД ЗА ДОМОМ')
      const small = BrandText.fit(ctx, subtitle, { width: 830, height: 120, maxFont: 38, minFont: 24, maxLines: 3, weight: 500 })
      ctx.font = '500 ' + small.size + 'px Arial, sans-serif'
      small.lines.forEach((line, i) => ctx.fillText(line, 512, 1090 + i * small.lineHeight))
      const texture = new T.CanvasTexture(canvas); texture.flipY = false; texture.encoding = T.sRGBEncoding; texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
      window.caddyLabelLayout = { text, lines: layout.lines, fontSize: layout.size }
      return texture
    }
    const timeout = setTimeout(() => { if (!ready) { failure = true; showFallback('model-timeout') } }, 20000)
    new T.GLTFLoader().load('/assets/cleaning-caddy.gltf', gltf => {
      clearTimeout(timeout)
      const model = gltf.scene, bounds = new T.Box3().setFromObject(model), center = bounds.getCenter(new T.Vector3())
      model.position.sub(center); world.add(model)
      model.traverse(object => {
        if (!object.isMesh) return
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach(material => { material.envMapIntensity = .45; if (material.name === 'Accent_Cobalt') material.color.set(window.SITE?.brand?.accent || '#2054ec') })
        if (object.name === 'Spray_Label') {
          object.material = new T.MeshStandardMaterial({ map: labelTexture(), roughness: .65, metalness: 0, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
        }
      })
      fitBox = new T.Box3().setFromObject(model); resize(); renderer.render(scene, camera)
      ready = true; failure = false
      if (!lost) { fallback.hidden = true; fallback.style.display = 'none'; note.style.display = 'none'; renderer.domElement.style.visibility = 'visible'; window.sceneStatus = 'webgl' }
      hint.textContent = innerWidth < 760 || reduced.matches ? 'Набор для уборки' : 'Лёгкий наклон вслед за мышью'
    }, undefined, error => { clearTimeout(timeout); failure = true; console.warn('Не удалось загрузить 3D-модель.', error); showFallback('model-error') })
    let last = 0, elapsed = 0
    function frame(now) {
      requestAnimationFrame(frame)
      const dt = Math.min((now - last) / 1000 || 0, .05); last = now
      if (!ready || failure || lost || !visible || document.hidden) return
      if (!paused) {
        elapsed += dt
        const mobile = innerWidth < 760
        rx += ((mobile ? 0 : targetX * .12) - rx) * .06; ry += ((mobile ? 0 : targetY * .055) - ry) * .06
        world.rotation.y = rx; world.rotation.x = ry
        world.position.y = reduced.matches || mobile ? 0 : Math.sin(elapsed * .7) * .002
      }
      renderer.render(scene, camera)
    }
    requestAnimationFrame(frame)
  } catch (error) {
    if (renderer) { renderer.domElement.remove(); renderer.dispose() }
    console.warn('3D недоступно: показана статичная версия.', error); showFallback('fallback')
  }
})()
