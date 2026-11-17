import { createCleaningScene } from "./scene.js";

const params = new URLSearchParams(window.location.search);
const demoMode = params.get("demo") === "1";
const safeText = (value, fallback, max = 80) => String(value || fallback).trim().slice(0, max);
const safeRate = (name, fallback) => {
  const value = Math.round(Number(params.get(name)) || 0);
  return value >= 20 && value <= 1000 ? value : fallback;
};
const accent = /^#[0-9a-f]{6}$/i.test(`#${params.get("accent") || ""}`) ? `#${params.get("accent")}` : "#5b72ff";
const demoConfig = {
  brand: safeText(params.get("brand"), "легче", 50),
  modelName: safeText(params.get("model"), "Полный комплект", 70),
};
const rates = {
  regular: demoMode ? safeRate("regular", 70) : 70,
  deep: demoMode ? safeRate("deep", 130) : 130,
  renovation: demoMode ? safeRate("renovation", 170) : 170,
};
const names = { regular: "Поддерживающая", deep: "Генеральная", renovation: "После ремонта" };
const modelForType = { regular: "Caddy", deep: "DetailBrush", renovation: "CompactVacuum" };
const money = (value) => `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let type = "regular";
let area = 50;
let total = Math.max(2500, area * rates.regular);
const paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (demoMode) {
  document.documentElement.style.setProperty("--electric", accent);
  document.documentElement.style.setProperty("--electric-dark", accent);
  $$(".brand > span:last-child").forEach((element) => { element.textContent = demoConfig.brand; });
  $("#clientModelTitle").textContent = demoConfig.modelName;
  document.title = `${demoConfig.brand} - персональный демо-сайт`;
}
const scene = createCleaningScene($("#clientModel"), { isPaused: () => paused, accentColor: accent });

function selectModel(name, label) {
  scene.focus(name);
  $$("[data-model]").forEach((button) => button.classList.toggle("is-active", button.dataset.model === name));
  if (label) $("#clientModelTitle").textContent = demoMode ? demoConfig.modelName : label;
}

$$('[data-model]').forEach((button) => {
  button.addEventListener("click", () => selectModel(button.dataset.model, button.dataset.label));
});

$$('[data-focus-model]').forEach((button) => {
  button.addEventListener("click", () => selectModel(button.dataset.focusModel, "Полный комплект"));
});

function clearStatus() {
  const status = $("#status");
  status.hidden = true;
  status.classList.remove("success");
}

function updateCalculator() {
  const base = Math.max(2500, area * rates[type]);
  const lines = [[`${names[type]} · ${area} м²`, money(base)]];
  total = base;

  $$(".extra-option input:checked").forEach((input) => {
    total += Number(input.value);
    lines.push([input.dataset.title, money(Number(input.value))]);
  });

  $("#price").textContent = money(total);
  $("#totalPrice").textContent = money(total);
  $("#formEstimate").textContent = `${names[type]}, ${area} м² · ${money(total)}`;
  $("#breakdown").replaceChildren(...lines.map(([label, value]) => {
    const row = document.createElement("div");
    const nameElement = document.createElement("span");
    const valueElement = document.createElement("span");
    nameElement.textContent = label;
    valueElement.textContent = value;
    row.append(nameElement, valueElement);
    return row;
  }));
  clearStatus();
}

function setType(nextType, focusModel = true) {
  type = nextType;
  $$('[data-type]').forEach((button) => {
    const active = button.dataset.type === type;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $$('[data-service-card]').forEach((card) => card.classList.toggle("is-active", card.dataset.serviceCard === type));
  if (focusModel) selectModel(modelForType[type], type === "regular" ? "Полный комплект" : names[type]);
  updateCalculator();
}

$$('[data-type]').forEach((button) => button.addEventListener("click", () => setType(button.dataset.type)));
$$('[data-service]').forEach((button) => {
  button.addEventListener("click", () => {
    setType(button.dataset.service, false);
    selectModel(button.dataset.modelTarget, names[button.dataset.service]);
    $("#calculator").scrollIntoView({ behavior: paused ? "auto" : "smooth" });
  });
});

$("#areaRange").addEventListener("input", (event) => {
  area = Number(event.target.value);
  $("#area").value = area;
  updateCalculator();
});

$("#area").addEventListener("input", (event) => {
  if (!event.target.value || !event.target.validity.valid) return;
  area = Number(event.target.value);
  $("#areaRange").value = area;
  updateCalculator();
});

$("#area").addEventListener("change", (event) => {
  area = Math.min(250, Math.max(20, Math.round(Number(event.target.value) || 20)));
  event.target.value = area;
  $("#areaRange").value = area;
  updateCalculator();
});

$$('.extra-option input').forEach((input) => input.addEventListener("change", updateCalculator));

const dateInput = $("#date");
const today = new Date();
const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
dateInput.min = localDate;
$("#startedAt").value = String(Date.now());

$("#bookingForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#status");
  const digits = $("#phone").value.replace(/\D/g, "");

  if (!form.checkValidity()) {
    status.hidden = false;
    status.textContent = "Заполните имя, телефон и подтвердите использование тестовых данных.";
    form.reportValidity();
    return;
  }
  if (digits.length < 10 || digits.length > 15) {
    status.hidden = false;
    status.textContent = "Проверьте тестовый номер: нужно от 10 до 15 цифр.";
    $("#phone").focus();
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const originalButton = submitButton.innerHTML;
  const extras = $$(".extra-option input:checked").map((input) => ({
    title: input.dataset.title,
    price: Number(input.value),
  }));
  const payload = {
    name: $("#name").value.trim(),
    phone: $("#phone").value.trim(),
    date: $("#date").value,
    address: $("#address").value.trim(),
    comment: $("#comment").value.trim(),
    service: type,
    area,
    extras,
    estimate: total,
    website: $("#website").value,
    startedAt: Number($("#startedAt").value),
    page: window.location.href,
  };

  submitButton.disabled = true;
  submitButton.textContent = "Отправляем...";
  status.hidden = true;
  status.classList.remove("success");

  const send = async () => {
    if (import.meta.env.DEV) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return { ok: true, preview: true };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Не удалось отправить заявку");
      return result;
    } finally {
      clearTimeout(timeout);
    }
  };

  send().then(() => {
    status.hidden = false;
    status.classList.add("success");
    status.textContent = "Спасибо! Заявка отправлена. Менеджер свяжется с вами, чтобы подтвердить детали.";
    form.reset();
    $("#startedAt").value = String(Date.now());
  }).catch((error) => {
    status.hidden = false;
    status.textContent = error.name === "AbortError"
      ? "Сервис отвечает дольше обычного. Попробуйте отправить заявку ещё раз."
      : "Не удалось отправить заявку. Проверьте соединение и попробуйте ещё раз.";
  }).finally(() => {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButton;
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("is-visible");
    observer.unobserve(entry.target);
  });
}, { threshold: 0.08 });

$$('.reveal:not(.is-visible)').forEach((element) => observer.observe(element));
updateCalculator();
