// Подставляет данные из config.js (или из примера для лида /p/<slug>) в страницу. Менять этот файл не нужно.
(() => {
  'use strict'
  const S = window.SITE
  if (!S || window.__PREVIEW_MISSING__) return
  const liveTest=new URLSearchParams(location.search).get('live-test')==='1' && !S.preview
  window.__LIVE_TEST__=liveTest
  if (previewMode() || liveTest) {
    const note=document.createElement('div'); note.className='demo-banner'; note.setAttribute('role','note'); note.textContent=liveTest?'ЖИВОЙ ТЕСТ: заявка будет сохранена и отправлена в настоящий Telegram. Только тестовые данные. Требуются вход в /admin и включённый режим проверки.':'Концепт сайта • не официальный сайт компании. Тестовая форма: контакты не сохраняются и не отправляются.'; note.style.cssText='position:relative;z-index:20;padding:12px 24px;background:#112632;color:white;font:14px/1.5 system-ui;text-align:center'; document.body.prepend(note);
    const nav=document.querySelector('.navwrap'); if(nav) nav.style.top=note.offsetHeight+'px';
    const btn=document.querySelector('.form-btn'); if(btn) btn.firstChild.textContent=liveTest?'Отправить тест в Telegram ':'Протестировать заявку ';
  }
  function previewMode(){return S.preview || S.site?.demo !== false}
  const preview = S.preview || ''
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S)
  const money = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽'

  // Текстовые поля. В примере для лида пустые поля скрываются, чтобы не было заглушек.
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const key = el.dataset.cfg
    const v = key === 'year' ? String(new Date().getFullYear()) : get(key)
    if (v != null && v !== '') el.textContent = v
    else if ((preview || S.site?.demo !== false) && !key.startsWith('legal.')) el.hidden = true
  })

  // Ссылки: data-cfg-href="tel:contacts.phoneHref" | "mailto:contacts.email" | "contacts.telegram"
  document.querySelectorAll('[data-cfg-href]').forEach((el) => {
    const m = /^(tel:|mailto:)?(.+)$/.exec(el.dataset.cfgHref)
    const v = get(m[2])
    if (v) el.href = (m[1] || '') + v
    else if (el.hasAttribute('data-cfg-hide-empty') || preview || S.site?.demo !== false) el.hidden = true
  })

  if (S.site?.demo !== false && !preview) { const legal=document.querySelector('.footer-end > span'); if(legal)legal.textContent='© '+new Date().getFullYear()+' '+S.brand.name+' · Вымышленная компания, учебный пример' }

  // Заголовок и мета-теги
  const fill = (t) =>
    t
      .replaceAll('[Название компании]', S.brand.name)
      .replaceAll(' в [Город]', S.city ? ' в ' + S.city : '')
      .replaceAll('[Город]', S.city || '')
  document.title = fill(document.title)
  document.querySelectorAll('meta[name="description"],meta[property^="og:"]').forEach((m) => m.setAttribute('content', fill(m.getAttribute('content'))))

  if (S.site?.demo !== false && !preview) {
    const r=document.createElement('meta');r.name='robots';r.content='noindex,nofollow';document.head.append(r)
  }
  if (preview) {
    // Пример для лида: не индексируем, ссылки ведут внутри примера
    const r = document.createElement('meta')
    r.name = 'robots'
    r.content = 'noindex,nofollow'
    document.head.append(r)
    const base = '/p/' + preview
    document.querySelectorAll('a[href="/privacy.html"]').forEach((a) => (a.href = base + '/privacy'))
    document.querySelectorAll('a[href="/"]').forEach((a) => (a.href = base))
    // Реквизитов в примере нет — в подвале остаётся «© год Название»
    const inn = document.querySelector('.footer-end [data-cfg="legal.inn"]')
    if (inn && !S.legal.inn) inn.parentElement.textContent = '© ' + new Date().getFullYear() + ' ' + S.brand.name
    document.querySelectorAll('[data-cfg^="legal."]').forEach((el) => {
      if (!get(el.dataset.cfg)) el.textContent = el.dataset.cfg === 'legal.companyName' ? S.brand.name : '—'
    })
  } else if (S.site && S.site.url) {
    const c = document.createElement('link')
    c.rel = 'canonical'
    c.href = S.site.url + location.pathname
    document.head.append(c)
  }

  // Фирменный цвет и надпись на статичном флаконе (если WebGL недоступен)
  const root = document.documentElement.style
  if (S.brand.accent) root.setProperty('--blue', S.brand.accent)
  root.setProperty('--brand-label', JSON.stringify(S.brand.bottleName || ''))

  // Калькулятор: доп. услуги и строка с тарифами
  const P = S.pricing
  const extras = document.getElementById('extras')
  if (P && extras && Array.isArray(P.extras)) {
    extras.replaceChildren(
      ...P.extras.map((x) => {
        const l = document.createElement('label')
        l.className = 'extra'
        const i = document.createElement('input')
        i.type = 'checkbox'
        i.value = String(x.price)
        i.dataset.title = x.title
        const s = document.createElement('span')
        s.textContent = x.label
        const sm = document.createElement('small')
        sm.textContent = '+' + money(x.price)
        s.append(sm)
        l.append(i, s)
        return l
      })
    )
  }
  const note = document.getElementById('pricingNote')
  if (P && note) {
    const r = P.rates
    note.textContent = `Тарифы: ${r.regular}, ${r.deep} и ${r.renovation} ₽/м². Минимальная стоимость уборки: ${money(P.minOrder)}. Расчёт носит информационный характер и не является публичной офертой.`
  }

  // Разметка для поисковиков (только на настоящем сайте)
  if (preview) return
  const ld = document.createElement('script')
  ld.type = 'application/ld+json'
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'HouseCleaningService',
    name: S.brand.name,
    url: S.site && S.site.url,
    telephone: S.contacts.phoneHref,
    email: S.contacts.email,
    address: S.contacts.address,
    areaServed: S.city,
    openingHours: S.contacts.hours,
    priceRange: P ? 'от ' + money(P.minOrder) : undefined,
  })
  document.head.append(ld)
})()
