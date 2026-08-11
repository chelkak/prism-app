/**
 * PRISM — сводка по очереди в мини-аппе.
 * Порт bot/queue_engine.py. Логика обязана совпадать с ботом:
 * любую правку вносить в оба файла.
 */
(function (global) {
  "use strict";

  const MAX_SHOWN = 5;
  const MAX_ITEMS = 300;

  const ROBOT_ADDR =
    /(noreply|no-reply|donotreply|do-not-reply|webregistrator|mailer|notification|newsletter|digest|rassylka)/i;
  const ROBOT_MARK =
    /(don'?t reply|не отвечать|не отвечайте|отписаться|unsubscribe|рассылка|дайджест|автоматическое (письмо|уведомление))/i;
  const ASKS_ME =
    /(можешь|можете|подтверди|подскажи|жду|ждём|ждем|прошу|нужно от|от тебя|от вас|ответь|ответьте|please|срочно|пришли|пришлите|отправьте|выставьте|сделайте|нужен|нужна|нужно)/i;

  const MONEY = /(\d{1,3}(?:[\s ]\d{3})+|\d+)\s*(?:₽|руб\.?|рублей|р\.|rub)/gi;
  const DEADLINE =
    /((?:сегодня|завтра|послезавтра)\s+до\s+\d{1,2}[:.]\d{2}|\b(?:сегодня|завтра|послезавтра)\b|до\s+\d{1,2}[:.]\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/gi;

  const STOP = new Set([
    "это","как","что","для","или","если","так","все","уже","еще","ещё","там",
    "тут","был","была","быть","есть","нет","да","не","по","на","в","с","и","а",
    "но","то","же","бы","вы","мы","здравствуйте","добрый","день","утро","вечер",
    "привет","спасибо","пожалуйста","прошу",
  ]);

  function words(text) {
    const raw = (text || "").toLowerCase().match(/[а-яёa-z]{3,}/g) || [];
    return new Set(raw.filter((w) => !STOP.has(w)));
  }

  function normSender(s) {
    s = (s || "").trim().toLowerCase();
    const m = s.match(/[\w.+-]+@[\w.-]+/);
    if (m) return m[0];
    return s.replace(/[«»"'()]+/g, "").replace(/\s+/g, " ") || "без отправителя";
  }

  /** Режет вставленный текст на элементы. Порядок проверок — как в ТЗ. */
  function splitItems(raw) {
    raw = (raw || "").replace(/\r/g, "").trim();
    if (!raw) return [];

    let chunks = raw.split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);

    if (chunks.length < 2) {
      const byNum = raw.split(/\n(?=\s*(?:\d{1,3}[).]|#\d+)\s)/)
        .map((c) => c.trim()).filter(Boolean);
      chunks = byNum.length >= 2 ? byNum : [];
    }
    if (!chunks.length) {
      const byFrom = raw.split(/\n(?=\s*(?:От|От кого|Клиент|From)\s*:)/i)
        .map((c) => c.trim()).filter(Boolean);
      chunks = byFrom.length >= 2 ? byFrom : [raw];
    }

    const items = chunks.slice(0, MAX_ITEMS).map((chunk, i) => parseChunk(i + 1, chunk));
    if (chunks.length > MAX_ITEMS && items.length) {
      items[0].dropped = chunks.length - MAX_ITEMS;
    }
    return items;
  }

  function parseChunk(num, chunk) {
    let sender = "";
    let when = null;
    const body = [];

    for (const line of chunk.split("\n")) {
      let m = line.match(/^\s*(?:От|От кого|Клиент|From)\s*:\s*(.+)/i);
      if (m && !sender) { sender = m[1].trim(); continue; }
      m = line.match(/^\s*(?:Когда|Дата|Date)\s*:\s*(.+)/i);
      if (m && when === null) { when = parseWhen(m[1].trim()); continue; }
      body.push(line);
    }

    let text = body.join("\n").trim().replace(/^\s*(?:\d{1,3}[).]|#\d+)\s*/, "");

    if (!sender) {
      const first = text.split("\n")[0] || "";
      const m = first.match(/^\s*([^:]{2,40}?)\s*:\s+\S/);
      if (m && !/https?/.test(m[1])) sender = m[1].trim();
    }

    return {
      num, sender: sender || "без отправителя", text, when,
      score: 0, why: [], isRobot: false, money: [], deadlines: [],
      repeats: 1, sameTopic: false, dropped: 0,
    };
  }

  function parseWhen(s) {
    let m = s.match(/(\d{1,2})[.](\d{1,2})[.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) {
      return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    }
    m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m) {
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    }
    return null;
  }

  function uniq(list) {
    const out = [];
    for (const x of list) if (!out.includes(x)) out.push(x);
    return out;
  }

  function timesWord(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "раз";
    return n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? "раза" : "раз";
  }

  function daysWord(n) {
    if (n % 10 === 1 && n % 100 !== 11) return "день";
    if (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) return "дня";
    return "дней";
  }

  function analyzeQueue(items, now) {
    now = now || new Date();
    if (!items.length) return { total: 0, need: [], later: [], robots: [], dropped: 0 };

    // Группировка по отправителю: повторы и общая тема.
    const bySender = {};
    for (const it of items) {
      (bySender[normSender(it.sender)] = bySender[normSender(it.sender)] || []).push(it);
    }
    for (const group of Object.values(bySender)) {
      const topics = group.map((it) => words(it.text));
      let same = false;
      if (group.length >= 2 && topics.every((t) => t.size)) {
        const pairs = [];
        for (let a = 0; a < topics.length; a++) {
          for (let b = a + 1; b < topics.length; b++) {
            let common = 0;
            topics[a].forEach((w) => { if (topics[b].has(w)) common++; });
            pairs.push(common / Math.max(1, Math.min(topics[a].size, topics[b].size)));
          }
        }
        if (pairs.length && pairs.reduce((x, y) => x + y, 0) / pairs.length >= 0.3) same = true;
      }
      group.forEach((it) => { it.repeats = group.length; it.sameTopic = same; });
    }

    const dated = items.filter((i) => i.when);
    const oldest = dated.length ? Math.min(...dated.map((i) => +i.when)) : null;

    for (const it of items) {
      if (ROBOT_ADDR.test(it.sender) || ROBOT_MARK.test(it.sender + "\n" + it.text)) {
        it.isRobot = true; it.score = -10; continue;
      }

      it.money = uniq((it.text.match(MONEY) || []).map((m) => m.trim()));
      it.deadlines = uniq((it.text.match(DEADLINE) || []).map((m) => m.trim()));

      if (it.repeats >= 2) {
        it.score += 4 * (it.repeats - 1);
        const w = timesWord(it.repeats);
        if (it.sameTopic) {
          it.score += 3;
          it.why.push(`спрашивал ${it.repeats} ${w} об одной задаче`);
        } else {
          it.why.push(`писал ${it.repeats} ${w}`);
        }
      }

      if (it.when) {
        const days = Math.floor((now - it.when) / 86400000);
        if (oldest && +it.when === oldest && items.length > 1) {
          it.score += 3; it.why.push("ждут дольше всех");
        }
        if (days >= 1) {
          it.score += Math.min(days, 3);
          it.why.push(`ждут ${days} ${daysWord(days)}`);
        }
      }

      if (it.money.length) { it.score += 3; it.why.push("деньги: " + it.money.slice(0, 2).join(", ")); }
      if (it.deadlines.length) { it.score += 2; it.why.push("срок: " + it.deadlines[0]); }
      if (ASKS_ME.test(it.text)) it.score += 3;
    }

    const robots = items.filter((i) => i.isRobot);
    const rest = items.filter((i) => !i.isRobot);

    // Повторы одного человека — одна строка, а не пять.
    const seen = {};
    const collapsed = [];
    for (const it of rest.slice().sort((a, b) => a.num - b.num)) {
      const key = normSender(it.sender);
      if (it.repeats >= 2 && seen[key]) {
        const head = seen[key];
        head.score = Math.max(head.score, it.score);
        for (const m of it.money) if (!head.money.includes(m)) {
          head.money.push(m); head.score += 3; head.why.push("деньги: " + m);
        }
        for (const d of it.deadlines) if (!head.deadlines.includes(d)) {
          head.deadlines.push(d); head.score += 2; head.why.push("срок: " + d);
        }
        continue;
      }
      seen[key] = it;
      collapsed.push(it);
    }

    collapsed.sort((a, b) => b.score - a.score || a.num - b.num);
    const need = collapsed.filter((i) => i.score >= 4).slice(0, MAX_SHOWN);
    const needNums = new Set(need.map((i) => i.num));
    const later = collapsed.filter((i) => !needNums.has(i.num));

    return { total: items.length, need, later, robots, dropped: items[0].dropped || 0 };
  }

  global.PrismQueue = { splitItems, analyzeQueue };
})(window);
