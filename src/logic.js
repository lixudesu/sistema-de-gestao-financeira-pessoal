import { app, STORAGE_KEY, monthNames, categoryConfig, today } from "./context.js";
function createDefaultState() {
  return {
    settings: {
      baseSalary: 0,
    },
    years: {},
    subscriptions: [],
    charges: [],
    templates: [],
    credits: [],
  };
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return createDefaultState();
    return { ...createDefaultState(), ...JSON.parse(stored) };
  } catch {
    return createDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
}

function normalizeImportedState(payload) {
  const base = createDefaultState();
  if (!payload || typeof payload !== "object") {
    throw new Error("Arquivo de backup inválido.");
  }

  const years = payload.years && typeof payload.years === "object" ? payload.years : {};

  return {
    ...base,
    ...payload,
    settings: {
      ...base.settings,
      ...(payload.settings && typeof payload.settings === "object" ? payload.settings : {}),
    },
    years,
    subscriptions: Array.isArray(payload.subscriptions) ? payload.subscriptions : [],
    charges: Array.isArray(payload.charges) ? payload.charges : [],
    templates: Array.isArray(payload.templates) ? payload.templates : [],
    credits: Array.isArray(payload.credits) ? payload.credits : [],
  };
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRecurringItem(item, kind) {
  return {
    ...item,
    frequency: item.frequency || "monthly",
    dueMonth: Number.isInteger(item.dueMonth) ? item.dueMonth : item.startMonth ?? app.selectedMonth,
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
    description: kind === "charge" ? item.description || "" : undefined,
  };
}

function normalizeTemplateItem(item) {
  let inferredStart = null;

  Object.entries(app.state.years).forEach(([yearKey, yearData]) => {
    Object.keys(yearData.months || {}).forEach((monthKey) => {
      const saved = yearData.months?.[monthKey]?.templateValues?.[item.id];
      if (!saved) return;
      const candidate = {
        year: Number(yearKey),
        month: Number(monthKey),
      };
      if (!inferredStart || getMonthIndex(candidate.year, candidate.month) < getMonthIndex(inferredStart.year, inferredStart.month)) {
        inferredStart = candidate;
      }
    });
  });

  return {
    ...item,
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
    manual: Boolean(item.manual),
    startYear: Number.isInteger(item.startYear) ? item.startYear : inferredStart?.year ?? today.getFullYear(),
    startMonth: Number.isInteger(item.startMonth) ? item.startMonth : inferredStart?.month ?? today.getMonth(),
  };
}

function exportBackup() {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const blob = new Blob([JSON.stringify(app.state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `sf-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDay(value) {
  const day = Math.round(numberValue(value));
  return Math.max(1, Math.min(31, day || 1));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function ensureYear(year) {
  if (!app.state.years[year]) {
    app.state.years[year] = { months: {} };
  }
  return app.state.years[year];
}

function ensureMonth(year, month) {
  const yearData = ensureYear(year);
  const key = String(month);
  if (!yearData.months[key]) {
    yearData.months[key] = {
      baseSalary: null,
      extraIncome: 0,
      extras: [],
      bills: [],
      subscriptionPaid: {},
      chargePaid: {},
      templateValues: {},
      creditPaid: {},
    };
  }
  return yearData.months[key];
}

function getMonthData() {
  return ensureMonth(app.selectedYear, app.selectedMonth);
}

function readMonthData(year, month) {
  return app.state.years[year]?.months?.[String(month)] || null;
}

function monthHasData(year, month) {
  const data = readMonthData(year, month);
  if (!data) return false;
  return (
    data.baseSalary !== null ||
    numberValue(data.extraIncome) > 0 ||
    (Array.isArray(data.extras) && data.extras.length > 0) ||
    (Array.isArray(data.bills) && data.bills.length > 0) ||
    Object.keys(data.subscriptionPaid || {}).length > 0 ||
    Object.keys(data.chargePaid || {}).length > 0 ||
    Object.keys(data.templateValues || {}).length > 0 ||
    Object.keys(data.creditPaid || {}).length > 0
  );
}

function monthsBetween(startYear, startMonth, year, month) {
  return (year - startYear) * 12 + (month - startMonth);
}

function getMonthIndex(year, month) {
  return year * 12 + month;
}

function isOccurrenceOverdue(year, month, dueDay) {
  const occurrenceDate = new Date(year, month, clampDay(dueDay), 23, 59, 59, 999);
  return occurrenceDate.getTime() < today.getTime();
}

function isFutureViewMonth(year, month) {
  return getMonthIndex(year, month) > getMonthIndex(today.getFullYear(), today.getMonth());
}

function getListPriority(item) {
  if (item.overdue) return 0;
  if (item.recurringFrequency === "monthly") return 1;
  if (item.kind === "template") return 2;
  if (item.kind === "bill") return 3;
  if (item.kind === "credit") return 4;
  if (item.recurringFrequency === "once") return 5;
  if (item.recurringFrequency === "annual") return 6;
  return 7;
}

function sortMonthItems(items) {
  return items.sort((a, b) => {
    if (a.paid !== b.paid) return a.paid ? 1 : -1;
    const priorityDiff = getListPriority(a) - getListPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    const dueDayDiff = numberValue(a.dueDay) - numberValue(b.dueDay);
    if (dueDayDiff !== 0) return dueDayDiff;
    return String(a.title).localeCompare(String(b.title), "pt-BR");
  });
}

function getItemBaseKey(item) {
  if (item.kind === "subscription" || item.kind === "charge" || item.kind === "template") {
    return `${item.kind}:${item.sourceId || item.id}`;
  }
  if (item.kind === "credit") {
    return `${item.kind}:${item.creditId || item.id}`;
  }
  if (item.kind === "bill") {
    return `${item.kind}:${item.sourceId || item.id}`;
  }
  return `${item.kind}:${item.id}`;
}

function buildDisplayItems(items) {
  const rows = [];
  const pendingGroups = new Map();

  items.forEach((item) => {
    const shouldGroup = !item.paid && !item.staticEntry && ["subscription", "charge", "template", "credit"].includes(item.kind);
    if (!shouldGroup) {
      rows.push(item);
      return;
    }

    const key = getItemBaseKey(item);
    const group = pendingGroups.get(key) || [];
    group.push(item);
    pendingGroups.set(key, group);
  });

  pendingGroups.forEach((groupItems, key) => {
    if (groupItems.length === 1) {
      rows.push(groupItems[0]);
      return;
    }

    const overdueCount = groupItems.filter((item) => item.overdue).length;
    const currentCount = groupItems.length - overdueCount;
    rows.push({
      id: `group:${key}`,
      group: true,
      groupKey: key,
      kind: groupItems[0].kind,
      title: groupItems[0].title,
      value: groupItems.reduce((sum, item) => sum + numberValue(item.value), 0),
      dueDay: Math.min(...groupItems.map((item) => numberValue(item.dueDay))),
      paid: false,
      overdue: overdueCount > 0,
      groupedItems: groupItems,
      meta:
        overdueCount > 0
          ? `${overdueCount} atrasada${overdueCount > 1 ? "s" : ""}${currentCount ? ` • ${currentCount} atual` : ""}`
          : `${groupItems.length} pendências deste item`,
    });
  });

  return sortMonthItems(rows);
}

function calculateOverdueExpenses(items) {
  return items
    .filter((item) => item.overdue && !item.paid)
    .reduce((sum, item) => sum + numberValue(item.value), 0);
}

function getPaidOneTimeReceivableHistory(year, month, visibleItems = []) {
  const selectedIndex = getMonthIndex(year, month);
  const visibleChargeKeys = new Set(
    visibleItems
      .filter((item) => item.kind === "charge")
      .map((item) => `${item.sourceYear ?? year}:${item.sourceMonth ?? month}:${item.sourceId || item.id}`),
  );

  return sortMonthItems(
    app.state.charges
      .filter((charge) => (charge.frequency || "monthly") === "once")
      .filter((charge) => getMonthIndex(charge.startYear ?? year, charge.startMonth ?? month) <= selectedIndex)
      .map((charge) => {
        const occurrenceYear = charge.startYear ?? year;
        const occurrenceMonth = charge.startMonth ?? month;
        const visibilityKey = `${occurrenceYear}:${occurrenceMonth}:${charge.id}`;
        if (visibleChargeKeys.has(visibilityKey)) return null;

        const sourceData = readMonthData(occurrenceYear, occurrenceMonth);
        if (!sourceData?.chargePaid?.[charge.id]) return null;

        const snapshot = getRecurringSnapshot(charge, occurrenceYear, occurrenceMonth);
        return {
          id: `paid-charge:${occurrenceYear}:${occurrenceMonth}:${charge.id}`,
          kind: "charge",
          recurringFrequency: "once",
          sourceKind: "charge",
          sourceYear: occurrenceYear,
          sourceMonth: occurrenceMonth,
          sourceId: charge.id,
          title: snapshot.name,
          value: numberValue(snapshot.value),
          dueDay: snapshot.dueDay,
          paid: true,
          overdue: false,
          meta: `Pagamento único recebido em ${monthNames[occurrenceMonth]} ${occurrenceYear} • ${snapshot.description}`,
        };
      })
      .filter(Boolean),
  );
}

function getAllPaidOneTimeCharges() {
  return app.state.charges
    .filter((charge) => (charge.frequency || "monthly") === "once")
    .map((charge) => {
      const occurrenceYear = charge.startYear ?? app.selectedYear;
      const occurrenceMonth = charge.startMonth ?? app.selectedMonth;
      const sourceData = readMonthData(occurrenceYear, occurrenceMonth);
      if (!sourceData?.chargePaid?.[charge.id]) return null;

      const snapshot = getRecurringSnapshot(charge, occurrenceYear, occurrenceMonth);
      return {
        id: `charge-history:${occurrenceYear}:${occurrenceMonth}:${charge.id}`,
        kind: "charge",
        title: snapshot.name,
        value: numberValue(snapshot.value),
        dueDay: snapshot.dueDay,
        paid: true,
        overdue: false,
        recurringFrequency: "once",
        sourceKind: "charge",
        sourceYear: occurrenceYear,
        sourceMonth: occurrenceMonth,
        sourceId: charge.id,
        meta: `Pagamento Único recebido em ${monthNames[occurrenceMonth]} ${occurrenceYear} • ${snapshot.description}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const monthDiff = getMonthIndex(b.sourceYear, b.sourceMonth) - getMonthIndex(a.sourceYear, a.sourceMonth);
      if (monthDiff !== 0) return monthDiff;
      return String(a.title).localeCompare(String(b.title), "pt-BR");
    });
}

function getPastMonthRefs(year, month) {
  const refs = [];
  const currentIndex = getMonthIndex(year, month);
  Object.entries(app.state.years).forEach(([yearKey, yearData]) => {
    Object.keys(yearData.months || {}).forEach((monthKey) => {
      const refYear = Number(yearKey);
      const refMonth = Number(monthKey);
      if (getMonthIndex(refYear, refMonth) < currentIndex) {
        refs.push({ year: refYear, month: refMonth, data: yearData.months[monthKey] });
      }
    });
  });
  return refs.sort((a, b) => getMonthIndex(a.year, a.month) - getMonthIndex(b.year, b.month));
}

function isRecurringDue(item, year, month) {
  return getRecurringOccurrenceMonths(item, year, month).some((entry) => entry.year === year && entry.month === month);
}

function getRecurringSnapshot(item, year, month) {
  const normalized = normalizeRecurringItem(item, item.description !== undefined ? "charge" : "subscription");
  const base = {
    name: normalized.name,
    description: normalized.description,
    value: numberValue(normalized.value),
    dueDay: normalized.dueDay,
    dueMonth: normalized.dueMonth,
    frequency: normalized.frequency,
  };

  const targetIndex = getMonthIndex(year, month);
  normalized.revisions
    .slice()
    .sort((a, b) => getMonthIndex(a.year, a.month) - getMonthIndex(b.year, b.month))
    .forEach((revision) => {
      if (getMonthIndex(revision.year, revision.month) <= targetIndex) {
        Object.assign(base, revision);
      }
    });

  return base;
}

function getTemplateSnapshot(item, year, month) {
  const normalized = normalizeTemplateItem(item);
  const base = {
    name: normalized.name,
    value: numberValue(normalized.value),
    dueDay: normalized.dueDay,
    manual: normalized.manual,
    startYear: normalized.startYear,
    startMonth: normalized.startMonth,
  };

  const targetIndex = getMonthIndex(year, month);
  normalized.revisions
    .slice()
    .sort((a, b) => getMonthIndex(a.year, a.month) - getMonthIndex(b.year, b.month))
    .forEach((revision) => {
      if (getMonthIndex(revision.year, revision.month) <= targetIndex) {
        Object.assign(base, revision);
      }
    });

  return base;
}

function getRecurringOccurrenceMonths(item, targetYear, targetMonth) {
  const normalized = normalizeRecurringItem(item, item.description !== undefined ? "charge" : "subscription");
  const startYear = normalized.startYear ?? app.selectedYear;
  const startMonth = normalized.startMonth ?? app.selectedMonth;
  const startIndex = getMonthIndex(startYear, startMonth);
  const targetIndex = getMonthIndex(targetYear, targetMonth);
  if (targetIndex < startIndex) return [];

  const occurrences = [];
  const frequency = normalized.frequency || "monthly";

  if (frequency === "monthly") {
    occurrences.push({ year: startYear, month: startMonth });
    for (let index = startIndex + 1; index <= targetIndex; index += 1) {
      occurrences.push({ year: Math.floor(index / 12), month: index % 12 });
    }
  }

  if (frequency === "annual") {
    const dueMonth = normalized.dueMonth ?? startMonth;
    let nextYear = dueMonth >= startMonth ? startYear : startYear + 1;
    while (getMonthIndex(nextYear, dueMonth) <= targetIndex) {
      occurrences.push({ year: nextYear, month: dueMonth });
      nextYear += 1;
    }
  }

  if (frequency === "once") {
    occurrences.push({ year: startYear, month: startMonth });
  }

  return occurrences.filter((occurrence, index, list) => index === list.findIndex((entry) => entry.year === occurrence.year && entry.month === occurrence.month));
}

function upsertRecurringRevision(item, payload, year, month) {
  item.revisions = Array.isArray(item.revisions) ? item.revisions : [];
  const targetIndex = getMonthIndex(year, month);
  const startIndex = getMonthIndex(item.startYear ?? year, item.startMonth ?? month);
  const parsedDueMonth = payload.dueMonth === "" || payload.dueMonth === null || payload.dueMonth === undefined ? null : Number(payload.dueMonth);
  const sanitized = {
    year,
    month,
    name: payload.name,
    value: numberValue(payload.value),
    dueDay: clampDay(payload.dueDay),
    dueMonth: payload.frequency === "annual" || payload.frequency === "once" ? parsedDueMonth : null,
    frequency: payload.frequency,
  };

  if (payload.description !== undefined) {
    sanitized.description = payload.description;
  }

  if (targetIndex <= startIndex) {
    item.name = sanitized.name;
    item.value = sanitized.value;
    item.dueDay = sanitized.dueDay;
    item.dueMonth = sanitized.dueMonth;
    item.frequency = sanitized.frequency;
    if (sanitized.frequency === "once" && sanitized.dueMonth !== null) {
      item.startMonth = sanitized.dueMonth;
    }
    if (payload.description !== undefined) item.description = payload.description;
    return;
  }

  const existing = item.revisions.find((revision) => revision.year === year && revision.month === month);
  if (existing) {
    Object.assign(existing, sanitized);
  } else {
    item.revisions.push(sanitized);
  }
}

function getCreditInstallmentsForMonth(credit, year, month) {
  const diff = monthsBetween(credit.startYear, credit.startMonth, year, month);
  if (diff < 0) return [];

  const maxIndex = Math.min(diff, credit.installments - 1);
  const installments = [];
  for (let index = 0; index <= maxIndex; index += 1) {
    installments.push({
      credit,
      index,
      number: index + 1,
      overdue: index < diff,
      dueDay: credit.dueDay,
      value: credit.value,
    });
  }
  return installments;
}

function isCreditInstallmentPaid(credit, index) {
  return Array.isArray(credit.paid) && credit.paid.includes(index);
}

function setCreditInstallmentPaid(creditId, index, paid, persist = true) {
  const credit = app.state.credits.find((item) => item.id === creditId);
  if (!credit) return;
  credit.paid = Array.isArray(credit.paid) ? credit.paid : [];
  if (paid && !credit.paid.includes(index)) {
    credit.paid.push(index);
  }
  if (!paid) {
    credit.paid = credit.paid.filter((item) => item !== index);
  }
  if (persist) {
    saveState();
    render();
  }
}

function getCurrentItems() {
  return getItemsForMonth(app.selectedYear, app.selectedMonth);
}

function getItemsForMonth(year, month, options = {}) {
  const monthData = options.create === false ? readMonthData(year, month) : ensureMonth(year, month);
  if (!monthData) return [];
  const items = [];
  const includeOverdueCarryover = !isFutureViewMonth(year, month);
  const pastMonths = includeOverdueCarryover ? getPastMonthRefs(year, month) : [];

  monthData.bills.forEach((bill) => {
    items.push({
      id: bill.id,
      kind: "bill",
      title: bill.name,
      value: numberValue(bill.value),
      dueDay: bill.dueDay,
      paid: Boolean(bill.paid),
      overdue: !bill.paid && isOccurrenceOverdue(year, month, bill.dueDay),
      meta: "Conta do mês",
    });
  });

  pastMonths.forEach((past) => {
    (past.data.bills || []).forEach((bill) => {
      if (bill.paid) return;
      items.push({
        id: `late-bill:${past.year}:${past.month}:${bill.id}`,
        kind: "bill",
        sourceKind: "bill",
        sourceYear: past.year,
        sourceMonth: past.month,
        sourceId: bill.id,
        title: bill.name,
        value: numberValue(bill.value),
        dueDay: bill.dueDay,
        paid: false,
        overdue: true,
        meta: `Conta atrasada de ${monthNames[past.month]} ${past.year}`,
      });
    });
  });

  app.state.subscriptions.forEach((subscription) => {
    getRecurringOccurrenceMonths(subscription, year, month).forEach((occurrence) => {
      const snapshot = getRecurringSnapshot(subscription, occurrence.year, occurrence.month);
      const sourceData = readMonthData(occurrence.year, occurrence.month);
      const paid = Boolean(sourceData?.subscriptionPaid?.[subscription.id]);
      const isCurrentOccurrence = occurrence.year === year && occurrence.month === month;
      if (!includeOverdueCarryover && !isCurrentOccurrence) return;
      if (!isCurrentOccurrence && paid) return;
      items.push({
        id: isCurrentOccurrence ? subscription.id : `late-subscription:${occurrence.year}:${occurrence.month}:${subscription.id}`,
        kind: "subscription",
        recurringFrequency: snapshot.frequency,
        sourceKind: isCurrentOccurrence ? undefined : "subscription",
        sourceYear: isCurrentOccurrence ? undefined : occurrence.year,
        sourceMonth: isCurrentOccurrence ? undefined : occurrence.month,
        sourceId: isCurrentOccurrence ? undefined : subscription.id,
        title: snapshot.name,
        value: numberValue(snapshot.value),
        dueDay: snapshot.dueDay,
        paid: isCurrentOccurrence ? paid : false,
        overdue: !isCurrentOccurrence || (!paid && isOccurrenceOverdue(occurrence.year, occurrence.month, snapshot.dueDay)),
        meta: isCurrentOccurrence
          ? `Assinatura ${snapshot.frequency === "annual" ? `anual • ${monthNames[snapshot.dueMonth]}` : "mensal"}`
          : `Assinatura atrasada de ${monthNames[occurrence.month]} ${occurrence.year}`,
      });
    });
  });

  app.state.charges.forEach((charge) => {
    getRecurringOccurrenceMonths(charge, year, month).forEach((occurrence) => {
      const snapshot = getRecurringSnapshot(charge, occurrence.year, occurrence.month);
      const sourceData = readMonthData(occurrence.year, occurrence.month);
      const paid = Boolean(sourceData?.chargePaid?.[charge.id]);
      const isCurrentOccurrence = occurrence.year === year && occurrence.month === month;
      if (!includeOverdueCarryover && !isCurrentOccurrence) return;
      if (!isCurrentOccurrence && paid) return;
      items.push({
        id: isCurrentOccurrence ? charge.id : `late-charge:${occurrence.year}:${occurrence.month}:${charge.id}`,
        kind: "charge",
        recurringFrequency: snapshot.frequency,
        sourceKind: isCurrentOccurrence ? undefined : "charge",
        sourceYear: isCurrentOccurrence ? undefined : occurrence.year,
        sourceMonth: isCurrentOccurrence ? undefined : occurrence.month,
        sourceId: isCurrentOccurrence ? undefined : charge.id,
        title: snapshot.name,
        value: numberValue(snapshot.value),
        dueDay: snapshot.dueDay,
        paid: isCurrentOccurrence ? paid : false,
        overdue: !isCurrentOccurrence || (!paid && isOccurrenceOverdue(occurrence.year, occurrence.month, snapshot.dueDay)),
        meta: isCurrentOccurrence
          ? `${snapshot.description} • a receber ${snapshot.frequency === "annual" ? `anual • ${monthNames[snapshot.dueMonth]}` : snapshot.frequency === "once" ? `Pagamento Único • ${monthNames[snapshot.dueMonth ?? occurrence.month]}` : "mensal"}`
          : `A receber atrasado de ${monthNames[occurrence.month]} ${occurrence.year} • ${snapshot.description}`,
      });
    });
  });

  app.state.templates.forEach((template) => {
    const snapshot = getTemplateSnapshot(template, year, month);
    const templateStartIndex = getMonthIndex(snapshot.startYear ?? today.getFullYear(), snapshot.startMonth ?? today.getMonth());
    if (getMonthIndex(year, month) < templateStartIndex) return;
    const saved = monthData.templateValues[template.id] || {};
    const value = snapshot.manual ? numberValue(saved.value) : numberValue(saved.value ?? snapshot.value);
    items.push({
      id: template.id,
      kind: "template",
      title: snapshot.name,
      value,
      dueDay: snapshot.dueDay,
      paid: Boolean(saved.paid),
      overdue: !saved.paid && isOccurrenceOverdue(year, month, snapshot.dueDay),
      meta: snapshot.manual ? "Conta fixa preenchida manualmente neste mês" : "Conta fixa com valor padrão",
      manual: snapshot.manual,
    });
  });

  pastMonths.forEach((past) => {
    app.state.templates.forEach((template) => {
      const snapshot = getTemplateSnapshot(template, past.year, past.month);
      const templateStartIndex = getMonthIndex(snapshot.startYear ?? today.getFullYear(), snapshot.startMonth ?? today.getMonth());
      if (getMonthIndex(past.year, past.month) < templateStartIndex) return;
      const saved = past.data.templateValues?.[template.id] || {};
      if (saved.paid) return;
      const value = snapshot.manual ? numberValue(saved.value) : numberValue(saved.value ?? snapshot.value);
      if (snapshot.manual && !value) return;
      items.push({
        id: `late-template:${past.year}:${past.month}:${template.id}`,
        kind: "template",
        sourceKind: "template",
        sourceYear: past.year,
        sourceMonth: past.month,
        sourceId: template.id,
        title: snapshot.name,
        value,
        dueDay: snapshot.dueDay,
        paid: false,
        overdue: true,
        meta: `Conta fixa atrasada de ${monthNames[past.month]} ${past.year}`,
      });
    });
  });

  app.state.credits.forEach((credit) => {
    getCreditInstallmentsForMonth(credit, year, month).forEach((installment) => {
      if (!includeOverdueCarryover && installment.overdue) return;
      const paid = isCreditInstallmentPaid(credit, installment.index);
      if (!paid) {
        items.push({
          id: `${credit.id}:${installment.index}`,
          kind: "credit",
          creditId: credit.id,
          installmentIndex: installment.index,
          title: credit.name,
          value: numberValue(credit.value),
          dueDay: credit.dueDay,
          paid,
          overdue: installment.overdue || isOccurrenceOverdue(year, month, credit.dueDay),
          meta: `Parcela ${installment.number}/${credit.installments}${installment.overdue ? " atrasada" : ""}`,
        });
      }
    });
  });

  return sortMonthItems(items);
}

function calculateMonth(year = app.selectedYear, month = app.selectedMonth, options = {}) {
  const monthData = options.create === false ? readMonthData(year, month) : ensureMonth(year, month);
  const items = monthData ? getItemsForMonth(year, month, options) : [];
  const baseSalary =
    !monthData || monthData.baseSalary === null || monthData.baseSalary === undefined
      ? numberValue(app.state.settings.baseSalary)
      : numberValue(monthData.baseSalary);
  const extras = monthData && Array.isArray(monthData.extras) ? monthData.extras : [];
  const extraIncome =
    numberValue(monthData?.extraIncome) + extras.reduce((sum, item) => sum + numberValue(item.value), 0);
  const chargesReceived = items
    .filter((item) => item.kind === "charge" && item.paid)
    .reduce((sum, item) => sum + numberValue(item.value), 0);
  const chargesReceivable = items
    .filter((item) => item.kind === "charge" && !item.paid)
    .reduce((sum, item) => sum + numberValue(item.value), 0);
  const chargesReceivableCurrent = items
    .filter((item) => item.kind === "charge" && !item.paid && !item.overdue)
    .reduce((sum, item) => sum + numberValue(item.value), 0);
  const chargesReceivableOverdue = items
    .filter((item) => item.kind === "charge" && !item.paid && item.overdue)
    .reduce((sum, item) => sum + numberValue(item.value), 0);
  const income = baseSalary + extraIncome + chargesReceived;
  const expenseItems = items.filter((item) => item.kind !== "charge");
  const totalToPay = expenseItems.reduce((sum, item) => sum + numberValue(item.value), 0);
  const paid = expenseItems.filter((item) => item.paid).reduce((sum, item) => sum + numberValue(item.value), 0);
  const pending = totalToPay - paid;
  const leftover = income - pending;
  const categories = createCategoryTotals(items);

  return {
    baseSalary,
    extraIncome,
    chargesReceived,
    chargesReceivable,
    chargesReceivableCurrent,
    chargesReceivableOverdue,
    income,
    items,
    totalToPay,
    paid,
    pending,
    leftover,
    categories,
  };
}

function createCategoryTotals(items) {
  const categories = Object.fromEntries(
    Object.keys(categoryConfig).map((key) => [
      key,
      {
        ...categoryConfig[key],
        key,
        count: 0,
        total: 0,
        paid: 0,
        pending: 0,
        pendingCount: 0,
        overdueCount: 0,
        overdueTotal: 0,
      },
    ]),
  );

  items.forEach((item) => {
    const category = categories[item.kind];
    if (!category) return;
    const value = numberValue(item.value);
    category.count += 1;
    category.total += value;
    if (item.paid) {
      category.paid += value;
    } else {
      category.pending += value;
      category.pendingCount += 1;
    }
    if (item.overdue) {
      category.overdueCount += 1;
      category.overdueTotal += value;
    }
  });

  return categories;
}

function getAnnualMonths() {
  if (app.selectedYear < today.getFullYear()) {
    return Array.from({ length: 12 }, (_, index) => index);
  }

  if (app.selectedYear === today.getFullYear()) {
    return Array.from({ length: today.getMonth() + 1 }, (_, index) => index);
  }

  return Array.from({ length: 12 }, (_, index) => index).filter((month) => monthHasData(app.selectedYear, month));
}

function calculateAnnual() {
  const months = getAnnualMonths().map((month) => ({
    month,
    summary: calculateMonth(app.selectedYear, month, { create: false }),
  }));

  const categories = createCategoryTotals(months.flatMap((entry) => entry.summary.items));
  const totals = months.reduce(
    (acc, entry) => {
      acc.income += entry.summary.income;
      acc.totalToPay += entry.summary.totalToPay;
      acc.paid += entry.summary.paid;
      acc.pending += entry.summary.pending;
      acc.leftover += entry.summary.leftover;
      return acc;
    },
    { income: 0, totalToPay: 0, paid: 0, pending: 0, leftover: 0 },
  );

  return { months, categories, totals };
}

function getRecordedMonthRefs() {
  const refs = [];
  Object.entries(app.state.years).forEach(([yearKey, yearData]) => {
    Object.keys(yearData.months || {}).forEach((monthKey) => {
      const year = Number(yearKey);
      const month = Number(monthKey);
      if (year > today.getFullYear()) return;
      if (year === today.getFullYear() && month > today.getMonth()) return;
      if (!monthHasData(year, month)) return;
      refs.push({ year, month, data: yearData.months[monthKey] });
    });
  });
  return refs.sort((a, b) => getMonthIndex(a.year, a.month) - getMonthIndex(b.year, b.month));
}

function calculateAnnualOverview(annual = calculateAnnual()) {
  const months = annual.months.map((entry) => entry.month);
  const monthSet = new Set(months);
  const yearEndMonth = months.length ? months[months.length - 1] : app.selectedMonth;
  const yearEndIndex = getMonthIndex(app.selectedYear, yearEndMonth);
  const currentIndex = getMonthIndex(today.getFullYear(), today.getMonth());

  let salaryTotal = 0;
  let extrasTotal = 0;
  let fixedPaidTotal = 0;
  let fixedPendingTotal = 0;
  let manualPaidTotal = 0;
  let manualPendingTotal = 0;

  annual.months.forEach(({ month, summary: monthSummary }) => {
    const data = readMonthData(app.selectedYear, month);

    salaryTotal += monthSummary.baseSalary;
    extrasTotal += monthSummary.extraIncome;

    (data?.bills || []).forEach((bill) => {
      if (bill.paid) {
        manualPaidTotal += numberValue(bill.value);
      } else {
        manualPendingTotal += numberValue(bill.value);
      }
    });

    app.state.templates.forEach((item) => {
      const snapshot = getTemplateSnapshot(item, app.selectedYear, month);
      const saved = data?.templateValues?.[item.id];
      const value = snapshot.manual ? numberValue(saved?.value) : numberValue(saved?.value ?? snapshot.value);
      if (snapshot.manual && !value) return;
      if (saved?.paid) {
        fixedPaidTotal += value;
      } else {
        fixedPendingTotal += value;
      }
    });
  });

  let subscriptionsPaidTotal = 0;
  let subscriptionsPendingTotal = 0;
  let chargesReceivedTotal = 0;
  let chargesReceivableTotal = 0;

  app.state.subscriptions.forEach((item) => {
    getRecurringOccurrenceMonths(item, app.selectedYear, yearEndMonth)
      .filter((occurrence) => occurrence.year === app.selectedYear && monthSet.has(occurrence.month))
      .forEach((occurrence) => {
        const monthData = readMonthData(occurrence.year, occurrence.month);
        const snapshot = getRecurringSnapshot(item, occurrence.year, occurrence.month);
        if (monthData?.subscriptionPaid?.[item.id]) {
          subscriptionsPaidTotal += numberValue(snapshot.value);
        } else {
          subscriptionsPendingTotal += numberValue(snapshot.value);
        }
      });
  });

  app.state.charges.forEach((item) => {
    getRecurringOccurrenceMonths(item, app.selectedYear, yearEndMonth)
      .filter((occurrence) => occurrence.year === app.selectedYear && monthSet.has(occurrence.month))
      .forEach((occurrence) => {
        const monthData = readMonthData(occurrence.year, occurrence.month);
        const snapshot = getRecurringSnapshot(item, occurrence.year, occurrence.month);
        if (monthData?.chargePaid?.[item.id]) {
          chargesReceivedTotal += numberValue(snapshot.value);
        } else {
          chargesReceivableTotal += numberValue(snapshot.value);
        }
      });
  });

  const creditBorrowed = app.state.credits.reduce((sum, credit) => sum + numberValue(credit.value) * numberValue(credit.installments), 0);
  const creditPaid = app.state.credits.reduce(
    (sum, credit) => sum + numberValue(credit.value) * (Array.isArray(credit.paid) ? credit.paid.length : 0),
    0,
  );
  const creditRemaining = creditBorrowed - creditPaid;
  const revenueTotal = salaryTotal + extrasTotal + chargesReceivedTotal;
  const activeSubscriptions = app.state.subscriptions.filter((item) => getMonthIndex(item.startYear ?? today.getFullYear(), item.startMonth ?? 0) <= currentIndex);
  const subscriptionTotalValue = activeSubscriptions.reduce(
    (sum, item) => sum + numberValue(getRecurringSnapshot(item, today.getFullYear(), today.getMonth()).value),
    0,
  );
  const subscriptionActiveCount = app.state.subscriptions.filter((item) => getMonthIndex(item.startYear ?? app.selectedYear, item.startMonth ?? 0) <= yearEndIndex).length;
  const receivableActiveCount = app.state.charges.filter((item) => getMonthIndex(item.startYear ?? app.selectedYear, item.startMonth ?? 0) <= yearEndIndex).length;
  const totalPaidOut = subscriptionsPaidTotal + fixedPaidTotal + manualPaidTotal;
  const totalPendingToPay = subscriptionsPendingTotal + fixedPendingTotal + manualPendingTotal;
  const overallLeft = revenueTotal - totalPaidOut;

  return {
    months,
    salaryTotal,
    extrasTotal,
    chargesReceivedTotal,
    chargesReceivableTotal,
    revenueTotal,
    subscriptionsPaidTotal,
    subscriptionsPendingTotal,
    fixedPaidTotal,
    fixedPendingTotal,
    manualPaidTotal,
    manualPendingTotal,
    creditBorrowed,
    creditPaid,
    creditRemaining,
    subscriptionTotalValue,
    subscriptionActiveCount,
    receivableActiveCount,
    templateCount: app.state.templates.length,
    creditCount: app.state.credits.length,
    totalPaidOut,
    totalPendingToPay,
    overallLeft,
  };
}
export {
  createDefaultState,
  loadState,
  saveState,
  normalizeImportedState,
  uid,
  normalizeRecurringItem,
  normalizeTemplateItem,
  exportBackup,
  money,
  numberValue,
  clampDay,
  escapeHtml,
  ensureYear,
  ensureMonth,
  getMonthData,
  readMonthData,
  monthHasData,
  monthsBetween,
  getMonthIndex,
  isOccurrenceOverdue,
  isFutureViewMonth,
  getListPriority,
  sortMonthItems,
  getItemBaseKey,
  buildDisplayItems,
  calculateOverdueExpenses,
  getPaidOneTimeReceivableHistory,
  getAllPaidOneTimeCharges,
  getPastMonthRefs,
  isRecurringDue,
  getRecurringSnapshot,
  getTemplateSnapshot,
  getRecurringOccurrenceMonths,
  upsertRecurringRevision,
  getCreditInstallmentsForMonth,
  isCreditInstallmentPaid,
  setCreditInstallmentPaid,
  getCurrentItems,
  getItemsForMonth,
  calculateMonth,
  createCategoryTotals,
  getAnnualMonths,
  calculateAnnual,
  getRecordedMonthRefs,
  calculateAnnualOverview,
};
