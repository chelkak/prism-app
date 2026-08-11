/**
 * PRISM v2 — extractive triage for Telegram streams
 * No cloud AI in demo: analysis uses only the pasted text.
 */
(function () {
  "use strict";

  function bootTelegram() {
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (!tg) return;
      tg.ready();
      tg.expand();
      try {
        tg.setHeaderColor("#141210");
        tg.setBackgroundColor("#141210");
      } catch (_) {}
    } catch (_) {}
  }
  // SDK может подгрузиться чуть позже
  bootTelegram();
  setTimeout(bootTelegram, 300);
  setTimeout(bootTelegram, 1000);

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Коды P0-P3 остались внутренними — человеку показываем обычные слова.
  const PRIORITY = {
    P0: { code: "!", name: "Ждут сегодня", cls: "p0" },
    P1: { code: "•", name: "Ответить в пару дней", cls: "p1" },
    P2: { code: "•", name: "Не срочно", cls: "p2" },
    P3: { code: "—", name: "Можно не отвечать", cls: "p3" },
  };

  const MODE_META = {
    personal: {
      label: "Сообщение",
      hint: "Длинное сообщение друга или семьи: важно ли, чего от тебя ждут, что ответить, сохранить в заметки.",
    },
    work: {
      label: "Работа",
      hint: "Рабочий чат без Slack: контекст, горит/не горит, ждут ли тебя, черновик ответа.",
    },
    news: {
      label: "Новости",
      hint: "Пачка из канала или избранного: коротко что случилось, что можно не читать.",
    },
    vault: {
      label: "Заметки",
      hint: "Простые заметки из разборов: найти, пометить «устарело». Без сложных связей.",
    },
    docs: {
      label: "Документ",
      hint: "Договор, ТЗ, регламент: сроки, деньги, где противоречие — простым языком.",
    },
  };

  const EXAMPLES = {
    personal: [
      {
        title: "Друг · просит помощи",
        text: `Слушай, ты тут? Мне прям нужна твоя помощь.
Завтра до 14:00 надо сдать анкету на подработку, я половину не понимаю.
Можешь созвониться сегодня вечером после 20:00 минут на 30? Или хотя бы глянуть файл, я скину.
Если не можешь — напиши честно, я тогда Лену попрошу.
И ещё: тот долг 1500 помнишь? Могу вернуть в пятницу, ок?`,
      },
      {
        title: "Друг · просто поболтать",
        text: `Хаха ну ты видел вчерашний матч
жёстко затащили
как ты вообще, давно не писали
может как-нибудь пивасик`,
      },
    ],
    work: [
      {
        title: "Рабочий тред · клиент",
        text: `Марина (PM): @все клиент ждёт правки по ТЗ сегодня до 18:00
Игорь: я блокирован, нет доступов к Figma
Клиент: когда будет финальная версия? нам на согласование юр
Марина: без финального списка scope не отдаём
Ты (вчера): возьму API-часть
Марина: @ты подтверди пожалуйста что успеешь API к 17:00 иначе переносим демо
Игорь: +1 без API смысла нет
Клиент: жду статус`,
      },
      {
        title: "Рабочий · FYI",
        text: `Коллеги, на всякий случай: в понедельник серверные работы с 02:00 до 04:00, простой возможен.
Ничего делать не нужно, просто infо.
Хороших выходных!`,
      },
    ],
    news: [
      {
        title: "Пачка «новостей»",
        text: `1) ЦБ сохранил ставку — рынок спокойный
2) Новый закон о персональных данных вступит с сентября: штрафы выше
3) Стартап X привлёк раунд — нерелевантно
4) Курсы валют без резких движений
5) Крупный сбой у облачного провайдера ночью, уже восстановили
6) Мем про понедельник
7) Гайд: 10 привычек успешных — кликбейт
8) Открыта регистрация на отраслевую конференцию в октябре`,
      },
    ],
    docs: [
      {
        title: "Кусок ТЗ",
        text: `1. Срок сдачи модуля: 15.03
2. Оплата: 50% предоплата, 50% после приёмки
3. В scope: мобильная версия
4. Вне scope: интеграции с 1С
Примечание: мобильная версия может быть перенесена на этап 2 по согласованию.
Ответственный за приёмку — со стороны заказчика в течение 3 рабочих дней.
Штраф за просрочку 0.1% в день, но не более 10%.
В другом месте: интеграции с 1С «желательны в v1».`,
      },
    ],
    vault: [],
  };

  let mode = "auto";  // режим определяется по тексту, у человека не спрашиваем
  let lastResult = null;
  let vaultFilter = "all";

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2500);
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function tick() {
    const d = new Date();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $("#clock").textContent = t;
    const st = $("#splash-time");
    if (st) st.textContent = t;
  }

  function hideSplash() {
    const splash = $("#splash");
    if (!splash) return;
    splash.classList.add("gone");
  }

  function setView(name) {
    $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  }

  function setMode(m) {
    mode = m;
    $$(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    if (m !== "vault") mode = "auto";
    if (m === "vault") {
      setView("vault");
      renderVault();
      
      return;
    }
    setView("input");
    const roleRow = $("#role-row");
    if (roleRow) roleRow.style.display = m === "news" || m === "docs" ? "none" : "flex";
    
  }

  function renderExamples() {
    const box = $("#examples");
    if (!box) return;
    const list = EXAMPLES[mode] || [];
    box.innerHTML = list
      .map(
        (ex, i) =>
          `<button type="button" class="ex" data-i="${i}"><strong>${ex.title}</strong>${ex.text.slice(0, 90).replace(/\n/g, " ")}…</button>`
      )
      .join("");
    $$(".ex").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ex = list[Number(btn.dataset.i)];
        $("#raw-input").value = ex.text;
        $("#btn-run").disabled = false;
        toast("Пример подставлен — можно жать PRISM");
      });
    });
  }

  // ——— Extractive engine ———
  function normalize(text) {
    return text.replace(/\r/g, "").trim();
  }

  function sentences(text) {
    return text
      .split(/[\n.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
  }

  function lines(text) {
    return text
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function hasAny(text, arr) {
    const t = text.toLowerCase();
    return arr.filter((w) => t.includes(w.toLowerCase()));
  }

  function extractMoney(text) {
    const m = text.match(/(\d+[\s\d]*\d|\d+)\s*(₽|руб|рублей|р\b)/gi);
    const bare = text.match(/\b(\d{3,6})\b/g);
    const out = [];
    if (m) out.push(...m.map((x) => x.trim()));
    return out.slice(0, 5);
  }

  function extractDeadlines(text) {
    const patterns = [
      /(?:сегодня|завтра|послезавтра)\s+до\s+\d{1,2}[:.]\d{2}/gi,
      /(?:сегодня|завтра|послезавтра)\s+(?:утром|днём|днем|вечером)/gi,
      /\b(?:сегодня|завтра|послезавтра)\b/gi,
      /до\s+\d{1,2}[:.]\d{2}/gi,
      /до\s+\d{1,2}\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/gi,
      /\d{1,2}[./]\d{1,2}([./]\d{2,4})?/g,
      /в течение \d+ [^\s]+/gi,
      /к\s+\d{1,2}[:.]\d{2}/gi,
    ];
    const found = [];
    patterns.forEach((re) => {
      const m = text.match(re);
      if (m) found.push(...m.map((x) => x.trim()));
    });
    // Более длинное совпадение важнее: «завтра до 14:00» вместо «завтра».
    const uniq = [];
    for (const x of found) {
      if (uniq.some((u) => u.toLowerCase().includes(x.toLowerCase()))) continue;
      const i = uniq.findIndex((u) => x.toLowerCase().includes(u.toLowerCase()));
      if (i >= 0) uniq[i] = x;
      else uniq.push(x);
    }
    return uniq.slice(0, 6);
  }

  function scorePriority(text, modeName) {
    const t = text.toLowerCase();
    const why = [];
    let score = 0;

    const p0w = hasAny(t, [
      "срочно",
      "горит",
      "сегодня до",
      "до 18",
      "до 17",
      "блокер",
      "блокирован",
      "жду статус",
      "прям нужна",
      "нужна твоя помощь",
      "иначе",
      "штраф",
      "клиент ждёт",
      "клиент ждет",
    ]);
    const p1w = hasAny(t, [
      "нужно",
      "надо",
      "можешь",
      "подтверди",
      "прошу",
      "дедлайн",
      "срок",
      "созвон",
      "правки",
      "согласован",
      "важно",
      "завтра",
    ]);
    const waitMe = hasAny(t, [
      "@ты",
      "подтверди",
      "можешь",
      "нужна твоя",
      "ты тут",
      "от тебя",
      "твоей помощи",
      "глянуть",
      "пришли",
      "сделай",
      "ответь",
    ]);
    const fyi = hasAny(t, [
      "на всякий",
      "просто info",
      "просто infо",
      "fyi",
      "ничего делать не нужно",
      "для сведения",
    ]);
    const noise = hasAny(t, ["хаха", "мем", "пивасик", "как ты вообще", "кликбейт"]);

    if (p0w.length) {
      score += 5;
      why.push("сигналы срочности: " + p0w.slice(0, 3).join(", "));
    }
    if (waitMe.length) {
      score += 3;
      why.push("похоже, ждут действия/ответа от тебя");
    }
    if (p1w.length) {
      score += 2;
      why.push("есть запрос/срок: " + p1w.slice(0, 3).join(", "));
    }
    if (extractDeadlines(text).length) {
      score += 2;
      why.push("найден дедлайн в тексте");
    }
    if (extractMoney(text).length) {
      score += 1;
      why.push("есть суммы/деньги");
    }
    if (fyi.length) {
      score -= 3;
      why.push("похоже на FYI");
    }
    if (noise.length && modeName === "personal") {
      score -= 2;
      why.push("разговорный/лёгкий тон");
    }
    if (modeName === "news") score = Math.min(score, 3);

    let code = "P2";
    if (score >= 7) code = "P0";
    else if (score >= 4) code = "P1";
    else if (score <= 1 && (noise.length || fyi.length || text.length < 80)) code = "P3";

    if (!why.length) why.push("явных маркеров мало — оценка средняя, перепроверь глазами");

    return {
      priority: PRIORITY[code],
      score,
      why: why.join(" · "),
      waitMe: waitMe.length > 0 && !fyi.length,
      fyi: fyi.length > 0,
      money: extractMoney(text),
      deadlines: extractDeadlines(text),
    };
  }

  // Два случая, когда просить нечего. Ответ обязан им соответствовать,
  // иначе карточка сама себе противоречит.
  const NO_REQUEST = "Ничего. Можно не отвечать.";
  const WAITING_ONLY = "Ждут ответа, но что именно нужно — не написано.";

  /**
   * Короткая суть запроса. Никогда не возвращает исходный текст —
   * если сказать нечего, честно говорит, что просьбы не видно.
   */
  function pickNeed(text, meta, modeName) {
    if (meta.fyi) return "Ничего не нужно — просто прочитать.";
    if (modeName === "news") return "Ничего не нужно — это чтение для себя.";
    if (modeName === "docs") return "Свести противоречия в документе к одному варианту.";

    const t = text.toLowerCase();
    const bits = [];

    if (/созвон|созвонимся|позвони|call me/i.test(t)) bits.push("созвониться");
    if (/глян|посмотри|анкет|файл|документ/i.test(t)) bits.push("посмотреть файл");
    if (/подтверди|confirm|успеешь/i.test(t)) bits.push("подтвердить срок");
    if (/правк/i.test(t)) bits.push("внести правки");
    if (/жду статус|статус/i.test(t) && (modeName === "work" || /клиент/i.test(t)))
      bits.push("дать статус");
    if (/нужна твоя помощь|прям нужна|помоги|помочь/i.test(t)) bits.push("помочь");
    if (/блок|доступ|figma/i.test(t) && modeName === "work") bits.push("снять блокер");
    if (meta.money.length && /долг|верни|вернуть|верну|отда/i.test(t))
      bits.push("решить по деньгам (" + meta.money[0] + ")");

    const uniq = [];
    for (const b of bits) {
      if (!uniq.some((u) => u.includes(b) || b.includes(u))) uniq.push(b);
      if (uniq.length >= 3) break;
    }

    if (!uniq.length) {
      return meta.waitMe ? WAITING_ONLY : NO_REQUEST;
    }

    let need = uniq.join(", ");
    need = need.charAt(0).toUpperCase() + need.slice(1);
    if (meta.deadlines.length) need += " — до «" + meta.deadlines[0] + "»";
    return need + ".";
  }

  function buildTodos(text, meta, modeName) {
    const todos = [];
    if (meta.waitMe || meta.priority.cls === "p0" || meta.priority.cls === "p1") {
      todos.push({ tag: "do", text: "Ответить по сути (черновик ниже) — не оставлять прочитанным без реакции" });
    }
    if (meta.deadlines.length) {
      todos.push({ tag: "do", text: "Зафиксировать дедлайн: " + meta.deadlines[0] });
    }
    if (meta.money.length) {
      todos.push({ tag: "later", text: "Сверить суммы: " + meta.money.join(", ") });
    }
    if (modeName === "work" && /блок|доступ|figma|api/i.test(text)) {
      todos.push({ tag: "do", text: "Снять/эскалировать блокер из текста (доступ, API, зависимость)" });
    }
    if (modeName === "docs") {
      todos.push({ tag: "do", text: "Выписать противоречивые пункты и согласовать один вариант" });
    }
    if (meta.fyi || meta.priority.cls === "p3") {
      todos.push({ tag: "skip", text: "Можно не делать задач — положить в «прочитано»" });
    } else {
      todos.push({ tag: "later", text: "Если не успеваешь — написать срок/альтернативу (не молчать)" });
    }
    return todos.slice(0, 4);
  }

  function buildReply(text, meta, modeName, role, need) {
    // Ответ обязан соответствовать выводу: если просьбы нет — не обещаем помощь.
    if (need === NO_REQUEST || need === WAITING_ONLY) {
      if (need === WAITING_ONLY) {
        return "Привет! Прочитал. Что нужно от меня?";
      }
      // Просьбы нет — значит и готового ответа нет. Шаблон вроде
      // «спасибо, что написал» хуже, чем ничего: его стыдно отправить.
      return "";
    }
    if (modeName === "news") {
      return "Сводка для себя (не в чат):\n" + summarizeBullets(text, 5).map((b, i) => `${i + 1}. ${b}`).join("\n");
    }
    if (modeName === "docs") {
      return "Коллеги, по документу вижу расхождения в scope/сроках. Предлагаю созвон 15 мин или подтвердите единый вариант пункта X. Готов внести правку после вашего ок.";
    }
    if (meta.fyi) {
      return "Принял, спасибо. Если что-то понадобится с моей стороны — напишите.";
    }
    // Ничего не просят — не надо обещать помощь, надо просто по-человечески ответить.
    if (!meta.waitMe && meta.priority.cls === "p3" && modeName === "personal") {
      if (/боль|болел|врач|больниц|стоматолог|устал|тяжко|плохо/i.test(text)) {
        return "Ох, сочувствую. Держись! Как сейчас себя чувствуешь?";
      }
      return "Понял тебя) Спасибо, что рассказал. Давай на связи.";
    }

    // Коротко. Ответ должен читаться за секунду и отправляться как есть.
    const dl = meta.deadlines[0] ? ` к «${meta.deadlines[0]}»` : "";
    if (modeName === "work") {
      return meta.waitMe
        ? `Принял, беру в работу${dl}. Пришлю статус.`
        : `Спасибо. Что нужно от меня и к какому сроку?`;
    }

    // personal
    if (/созвон|вечером|минут|позвони/i.test(text)) {
      return `Привет! Давай сегодня после 20:00 — удобно?`;
    }
    if (meta.money.length && /долг|верни|вернуть|верну|отда/i.test(text)) {
      return `Привет! Понял. По ${meta.money[0]} решим, спишемся вечером.`;
    }
    return `Привет! Понял, помогу${dl}. Напиши подробнее.`;
  }

  function summarizeBullets(text, max) {
    const ls = lines(text);
    if (ls.length >= 3) {
      return ls
        .filter((l) => l.length > 10 && !/^хаха|мем/i.test(l))
        .slice(0, max)
        .map((l) => l.replace(/^\d+[).]\s*/, "").slice(0, 140));
    }
    return sentences(text).slice(0, max).map((s) => s.slice(0, 140));
  }

  function contextFrom(text, modeName) {
    const s = sentences(text);
    const ls = lines(text);
    if (modeName === "news") {
      return `В пачке ${ls.length} фрагментов. Ниже — сжатие только по тексту, без внешних фактов.`;
    }
    if (modeName === "docs") {
      return `Документ/фрагмент на ${text.length} символов. Ищу сроки, деньги, scope и противоречия в формулировках.`;
    }
    const head = (ls[0] || s[0] || "").slice(0, 120);
    const tail = (ls[ls.length - 1] || "").slice(0, 100);
    if (ls.length > 2) {
      return `Тред/сообщение (~${ls.length} строк). Начало: «${head}». Финал: «${tail}».`;
    }
    return (s[0] || text).slice(0, 220);
  }

  function docsFindings(text) {
    const bullets = [];
    const dl = extractDeadlines(text);
    const money = extractMoney(text);
    if (dl.length) bullets.push("Сроки в тексте: " + dl.join("; "));
    if (money.length) bullets.push("Суммы/условия: " + money.join("; "));
    if (/вне scope|не входит/i.test(text) && /желательн|в scope|входит/i.test(text)) {
      bullets.push("⚠ Возможно противоречие: что-то и «вне scope», и «желательно в v1»");
    }
    if (/этап 2|перенесен/i.test(text) && /scope: мобиль/i.test(text)) {
      bullets.push("⚠ Мобильная версия то в scope, то может быть на этап 2 — нужно одно решение");
    }
    if (!bullets.length) bullets.push("Явных маркеров мало — прочитай ключевые пункты вручную");
    return bullets;
  }

  /**
   * Режим определяется по тексту. У человека не спрашиваем —
   * он не обязан классифицировать своё сообщение за нас.
   */
  function detectMode(text) {
    const t = text.toLowerCase();
    const work = [
      "клиент", "дедлайн", "созвон", "тз", "релиз", "демо", "api",
      "отчёт", "отчет", "коллег", "проект", "вакан", "figma", "pm",
      "статус", "блокер", "заявк", "счёт", "счет", "договор", "оплат",
      "подряд", "смета", "акт", "накладн",
    ].filter((w) => t.includes(w)).length;

    if (work >= 2) return "work";
    if (/клиент/.test(t) && /статус/.test(t)) return "work";
    return "personal";
  }

  function analyze(text, modeName, role) {
    const raw = normalize(text);
    // "auto" или ничего — определяем сами.
    if (!modeName || modeName === "auto" || modeName === "vault") {
      modeName = detectMode(raw);
    }
    const meta = scorePriority(raw, modeName);
    const need = pickNeed(raw, meta, modeName);
    const todos = buildTodos(raw, meta, modeName);
    const reply = buildReply(raw, meta, modeName, role, need);
    let bullets = summarizeBullets(raw, modeName === "news" ? 8 : 5);
    let bulletsLabel = "КЛЮЧЕВЫЕ ФРАГМЕНТЫ ИЗ ТЕКСТА";

    if (modeName === "news") {
      bulletsLabel = "СВОДКА (must glance)";
      const ignore = lines(raw).filter((l) => /мем|кликбейт|пива/i.test(l));
      if (ignore.length) bullets.push("Шум/можно скипать: " + ignore.map((x) => x.slice(0, 40)).join(" · "));
    }
    if (modeName === "docs") {
      bulletsLabel = "НАХОДКИ / РИСКИ";
      bullets = docsFindings(raw);
    }

    const flags = [];
    if (meta.waitMe) flags.push({ t: "ждут меня", c: "on-me" });
    if (meta.fyi) flags.push({ t: "FYI", c: "" });
    if (meta.money.length) flags.push({ t: "деньги", c: "money" });
    if (meta.deadlines.length) flags.push({ t: "дедлайн", c: "deadline" });
    if (modeName === "docs") flags.push({ t: "документ", c: "" });

    return {
      mode: modeName,
      priority: meta.priority,
      why: meta.why,
      flags,
      context: contextFrom(raw, modeName),
      need,
      todos,
      reply,
      bullets,
      bulletsLabel,
      raw,
      createdAt: Date.now(),
    };
  }

  function global_PrismQueue() {
    return !!(window.PrismQueue && window.PrismQueue.splitItems);
  }

  // ——— Разобранное, отмена, недельный итог ———

  let lastQueue = null;
  let undoAction = null;

  /** Отмена последнего действия (Gmail): 6 секунд на передумать. */
  function offerUndo(text, restore) {
    undoAction = restore;
    const el = $("#toast");
    el.innerHTML = `${escapeHtml(text)} <button type="button" id="undo-btn">Отменить</button>`;
    el.classList.remove("hidden");
    clearTimeout(toast._t);
    const btn = $("#undo-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        if (undoAction) undoAction();
        undoAction = null;
        el.classList.add("hidden");
      });
    }
    toast._t = setTimeout(() => {
      el.classList.add("hidden");
      undoAction = null;
    }, 6000);
  }

  function markDone(num) {
    if (!lastQueue) return;
    const idx = lastQueue.need.findIndex((i) => i.num === num);
    if (idx < 0) return;
    const [item] = lastQueue.need.splice(idx, 1);
    bumpStat("done");
    paintQueue(lastQueue);
    offerUndo("Убрано из списка.", () => {
      lastQueue.need.splice(idx, 0, item);
      bumpStat("done", -1);
      paintQueue(lastQueue);
    });
  }

  /** Недельный итог (Wrapped): считаем разобранное, показываем и делимся. */
  const STATS_KEY = "prism_stats_v1";

  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
    } catch (_) {
      return {};
    }
  }

  function weekKey(d) {
    d = d || new Date();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  function bumpStat(field, by) {
    const s = loadStats();
    const k = weekKey();
    s[k] = s[k] || { parsed: 0, items: 0, done: 0 };
    s[k][field] = Math.max(0, (s[k][field] || 0) + (by === undefined ? 1 : by));
    try {
      localStorage.setItem(STATS_KEY, JSON.stringify(s));
    } catch (_) {}
    renderWeek();
  }

  function renderWeek() {
    const el = $("#week-line");
    if (!el) return;
    const s = loadStats()[weekKey()] || { parsed: 0, items: 0, done: 0 };
    if (!s.parsed) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.textContent =
      `За неделю: разобрано ${s.items || s.parsed}, закрыто ${s.done}`;
  }

  function weekShareText() {
    const s = loadStats()[weekKey()] || { parsed: 0, items: 0, done: 0 };
    return (
      `За неделю PRISM разобрал ${s.items || s.parsed} сообщений, ` +
      `из них требовали меня ${s.done}.\n\nБот: https://t.me/xPRISMxbot`
    );
  }

  /** Экран очереди: точное число сверху, до 5 строк, честный хвост. */
  function paintQueue(res) {
    const need = res.need || [];
    $("#q-count").textContent = need.length
      ? `Требуют тебя: ${need.length} из ${res.total}`
      : `Ничего срочного. Разобрал ${res.total}`;

    // Одно решение на карточку (Tinder): «Готово» — и она уходит.
    $("#q-list").innerHTML = need
      .map((it) => {
        const who = it.sender !== "без отправителя" ? it.sender : `#${it.num}`;
        const what = escapeHtml(clip(it.text, 70));
        const why = escapeHtml(cap((it.why || []).slice(0, 2).join(" · ")));
        return `<article class="q-item" data-num="${it.num}">
            <div class="q-who">${escapeHtml(who)}</div>
            <div class="q-what">${what}</div>
            ${why ? `<div class="q-why">${why}</div>` : ""}
            <button type="button" class="q-done" data-done="${it.num}">Готово</button>
          </article>`;
      })
      .join("");

    $$("#q-list [data-done]").forEach((b) => {
      b.addEventListener("click", () => markDone(Number(b.dataset.done)));
    });

    const tail = [];
    if (res.later && res.later.length) tail.push(`Остальные ${res.later.length} — не требуют тебя.`);
    if (res.robots && res.robots.length) tail.push(`Рассылок отсеяно: ${res.robots.length}`);
    if (res.dropped) tail.push(`⚠ Не поместилось: ${res.dropped}. Раздели пачку.`);
    $("#q-tail").textContent = tail.join(" ");
  }

  function daysWordJs(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "день";
    if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return "дня";
    return "дней";
  }

  function clip(s, n) {
    s = (s || "").replace(/\s+/g, " ").trim();
    if (s.length <= n) return s;
    let cut = s.slice(0, n - 1);
    if (cut.includes(" ")) cut = cut.slice(0, cut.lastIndexOf(" "));
    return cut + "…";
  }

  function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  async function run() {
    const text = $("#raw-input").value.trim();
    if (text.length < 8) {
      toast("Вставь текст подлиннее");
      return;
    }
    // Без искусственной задержки: разбор мгновенный, скорость — и есть смысл.
    // Одно сообщение или пачка — решаем сами, у человека не спрашиваем.
    if (global_PrismQueue()) {
      const items = window.PrismQueue.splitItems(text);
      if (items.length >= 2) {
        lastQueue = window.PrismQueue.analyzeQueue(items);
        bumpStat("parsed");
        bumpStat("items", items.length);
        paintQueue(lastQueue);
        setView("queue");
        return;
      }
    }
    bumpStat("parsed");
    bumpStat("items");

    const roleEl = $("#role-select");
    const role = roleEl ? roleEl.value : "me";
    lastResult = analyze(text, mode, role);
    paintResult(lastResult);
    setView("result");
    
  }

  function paintResult(r) {
    const set = (sel, fn) => { const el = $(sel); if (el) fn(el); };

    set("#result-mode", (el) => { el.textContent = MODE_META[r.mode]?.label || r.mode; });
    set("#priority-banner", (el) => { el.className = "verdict " + r.priority.cls; });
    set("#p-name", (el) => { el.textContent = r.priority.name; });
    set("#flags", (el) => {
      el.innerHTML = r.flags.map((f) => `<span class="flag ${f.c}">${f.t}</span>`).join("");
    });
    set("#need-text", (el) => { el.textContent = r.need; });
    const hasReply = !!(r.reply && r.reply.trim());
    set("#reply-text", (el) => {
      el.textContent = r.reply || "";
      el.style.display = hasReply ? "" : "none";
    });
    set("#btn-copy-reply", (el) => { el.style.display = hasReply ? "" : "none"; });

    // Блоки ниже удалены из интерфейса как дублирующие исходный текст.
    set("#context-text", (el) => { el.textContent = r.context; });
    set("#todo-list", (el) => {
      el.innerHTML = r.todos
        .map((t) => `<li><span class="tag ${t.tag}">${t.tag === "do" ? "СЕЙЧАС" : t.tag === "later" ? "ПОТОМ" : "СКИП"}</span><span>${escapeHtml(t.text)}</span></li>`)
        .join("");
    });
    set("#bullets-label", (el) => { el.textContent = r.bulletsLabel; });
    set("#bullets", (el) => {
      el.innerHTML = r.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("");
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function copy(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallback(text));
    } else fallback(text);
  }
  function fallback(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {}
    ta.remove();
  }

  function fullDump(r) {
    return [
      `PRISM · ${r.priority.name}`,
      `Почему: ${r.why}`,
      ``,
      `Контекст: ${r.context}`,
      `Что от тебя: ${r.need}`,
      ``,
      `Задачи:`,
      ...r.todos.map((t) => `- [${t.tag}] ${t.text}`),
      ``,
      `Черновик:`,
      r.reply,
      ``,
      r.bulletsLabel + ":",
      ...r.bullets.map((b) => `• ${b}`),
    ].join("\n");
  }

  // ——— Vault (localStorage) ———
  function loadVault() {
    try {
      return JSON.parse(localStorage.getItem("prism_vault_v2") || "[]");
    } catch {
      return [];
    }
  }
  function saveVault(items) {
    localStorage.setItem("prism_vault_v2", JSON.stringify(items));
  }

  function saveCurrent() {
    if (!lastResult) return;
    const items = loadVault();
    items.unshift({
      id: String(Date.now()),
      mode: lastResult.mode,
      priority: lastResult.priority.name,
      title: lastResult.need.slice(0, 80),
      why: lastResult.why,
      context: lastResult.context,
      raw: lastResult.raw.slice(0, 2000),
      reply: lastResult.reply,
      actual: true,
      createdAt: lastResult.createdAt,
    });
    saveVault(items.slice(0, 100));
    toast("Сохранено в знания (на этом устройстве)");
  }

  // Заметки, сохранённые до перехода на человеческий язык, до сих пор
  // хранят P0-P3 в памяти телефона. Показываем их словами.
  const OLD_CODES = {
    P0: "Ждут сегодня",
    P1: "Ответить в пару дней",
    P2: "Не срочно",
    P3: "Можно не отвечать",
  };

  function humanPriority(p) {
    return OLD_CODES[String(p || "").trim()] || p || "";
  }

  function renderVault() {
    const q = ($("#vault-search").value || "").toLowerCase();
    let items = loadVault();
    if (vaultFilter !== "all") items = items.filter((i) => i.mode === vaultFilter);
    if (q) {
      items = items.filter(
        (i) =>
          (i.title || "").toLowerCase().includes(q) ||
          (i.raw || "").toLowerCase().includes(q) ||
          (i.context || "").toLowerCase().includes(q)
      );
    }
    const list = $("#vault-list");
    const empty = $("#vault-empty");
    if (!items.length) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    list.innerHTML = items
      .map((i) => {
        const date = new Date(i.createdAt).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        // Заметка истекает сама (Stories): через 30 дней спрашиваем, нужна ли.
        const days = Math.floor((Date.now() - i.createdAt) / 86400000);
        const expired = i.actual && days >= 30;
        return `<article class="vault-item${expired ? " expired" : ""}" data-id="${i.id}">
          ${expired ? `<div class="v-ask">Лежит ${days} ${daysWordJs(days)}. Это ещё нужно?
            <button type="button" data-act="keep">нужно</button>
            <button type="button" data-act="del">убрать</button></div>` : ""}
          <div class="v-top">
            <span class="v-p">${escapeHtml(humanPriority(i.priority))}</span>
            <span class="v-cat">${i.mode} · ${i.actual ? "актуально" : "устарело"} · ${date}</span>
          </div>
          <div class="v-title">${escapeHtml(i.title)}</div>
          <div class="v-meta">${escapeHtml((i.context || "").slice(0, 120))}</div>
          <div class="v-actions">
            <button type="button" data-act="open">открыть</button>
            <button type="button" data-act="stale">${i.actual ? "пометить устаревшим" : "вернуть актуальным"}</button>
            <button type="button" data-act="del">удалить</button>
          </div>
        </article>`;
      })
      .join("");

    list.querySelectorAll(".vault-item").forEach((el) => {
      el.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = el.dataset.id;
          const all = loadVault();
          const item = all.find((x) => x.id === id);
          if (!item) return;
          const act = btn.dataset.act;
          if (act === "del") {
            const rest = all.filter((x) => x.id !== id);
            saveVault(rest);
            renderVault();
            offerUndo("Удалено.", () => {
              const back = loadVault();
              back.push(item);
              back.sort((a, b) => b.createdAt - a.createdAt);
              saveVault(back);
              renderVault();
            });
          } else if (act === "keep") {
            // «Нужно» продлевает жизнь заметки ещё на 30 дней.
            item.createdAt = Date.now();
            saveVault(all);
            renderVault();
            toast("Оставили. Спросим снова через 30 дней");
          } else if (act === "stale") {
            item.actual = !item.actual;
            saveVault(all);
            renderVault();
          } else if (act === "open") {
            mode = item.mode === "vault" ? "personal" : item.mode;
            lastResult = {
              mode: item.mode,
              priority: PRIORITY[item.priority] || PRIORITY.P2,
              why: item.why || "",
              flags: [],
              context: item.context,
              need: item.title,
              todos: [{ tag: "later", text: "Открыто из знаний — перепрогони текст для свежего разбора" }],
              reply: item.reply || "",
              bullets: [item.raw.slice(0, 300)],
              bulletsLabel: "СОХРАНЁННЫЙ ФРАГМЕНТ",
              raw: item.raw,
              createdAt: item.createdAt,
            };
            $$(".mode").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
            paintResult(lastResult);
            setView("result");
          }
        });
      });
    });
  }

  function bind() {
    $$("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

    $("#raw-input").addEventListener("input", () => {
      $("#btn-run").disabled = $("#raw-input").value.trim().length < 8;
    });
    $("#btn-run").addEventListener("click", run);

    const clipBtn = $("#btn-clipboard");
    if (clipBtn) {
      clipBtn.addEventListener("click", async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (!text || text.trim().length < 3) {
            toast("Буфер пуст — сначала скопируй кусок чата");
            return;
          }
          $("#raw-input").value = text;
          $("#btn-run").disabled = text.trim().length < 8;
          toast("Вставлено. Можно «Разобрать»");
        } catch (_) {
          toast("Нет доступа к буферу — вставь Ctrl+V в поле");
          $("#raw-input").focus();
        }
      });
    }
    $("#btn-back").addEventListener("click", () => {
      setView("input");
      
    });
    const copyReply = () => {
      if (!lastResult) return;
      copy(lastResult.reply);
      toast("Ответ скопирован — вставляй в чат");
    };
    const weekBtn = $("#week-line");
    if (weekBtn) weekBtn.addEventListener("click", () => {
      copy(weekShareText());
      toast("Итог недели скопирован — можно отправить");
    });

    const btnBackQ = $("#btn-back-q");
    if (btnBackQ) btnBackQ.addEventListener("click", () => setView("input"));

    const btnCopy = $("#btn-copy-reply");
    if (btnCopy) btnCopy.addEventListener("click", copyReply);
    const btnAll = $("#btn-copy-all");
    if (btnAll) {
      btnAll.addEventListener("click", () => {
        if (!lastResult) return;
        copy(fullDump(lastResult));
        toast("Весь разбор скопирован");
      });
    }
    $("#btn-save").addEventListener("click", saveCurrent);
    $("#vault-search").addEventListener("input", renderVault);
    $$("#vault-filters .chip").forEach((c) => {
      c.addEventListener("click", () => {
        vaultFilter = c.dataset.filter;
        $$("#vault-filters .chip").forEach((x) => x.classList.toggle("active", x === c));
        renderVault();
      });
    });
  }

  function init() {
    try {
      bind();
      tick();
      setInterval(tick, 1000);
      setMode("personal");
    renderWeek();
    } catch (err) {
      console.error("PRISM init error", err);
    } finally {
      hideSplash();
      setTimeout(hideSplash, 200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
