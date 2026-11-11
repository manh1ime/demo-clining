// Подставляет данные из config.js в страницу. Менять этот файл не нужно.
(() => {
  'use strict'
  const S = window.SITE
  if (!S) return
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), S)
  const money = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽'

  // Текстовые поля
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const key = el.dataset.cfg
    const v = key === 'year' ? String(new Date().getFullYear()) : get(key)
    if (v != null && v !== '') el.textContent = v
  })

  // Ссылки: data-cfg-href="tel:contacts.phoneHref" | "mailto:contacts.email" | "contacts.telegram"
  document.querySelectorAll('[data-cfg-href]').forEach((el) => {
    const m = /^(tel:|mailto:)?(.+)$/.exec(el.dataset.cfgHref)
    const v = get(m[2])
    if (v) el.href = (m[1] || '') + v
    else if (el.hasAttribute('data-cfg-hide-empty')) el.hidden = true
  })

  // Заголовок и мета-теги
  const fill = (t) => t.replaceAll('[Название компании]', S.brand.name).replaceAll('[Город]', S.city)
  document.title = fill(document.title)
  document.querySelectorAll('meta[name="description"],meta[property^="og:"]').forEach((m) => m.setAttribute('content', fill(m.getAttribute('content'))))
  if (S.site && S.site.url) {
    const c = document.createElement('link')
    c.rel = 'canonical'
    c.href = S.site.url + location.pathname
    document.head.append(c)
  }

  // Надпись на статичном флаконе (если WebGL недоступен)
  document.documentElement.style.setProperty('--brand-label', JSON.stringify(S.brand.bottleName || ''))

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

  // Разметка для поисковиков
  const ld = document.createElement('script')
  ld.type = 'application/ld+json'
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'HouseCleaningService', // eslint-disable-line
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
