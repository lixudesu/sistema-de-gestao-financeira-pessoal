const STORAGE_KEY = "sf-financeiro-v1";

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const monthShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const weekdayShort = ["D", "S", "T", "Q", "Q", "S", "S"];
const categoryConfig = {
  subscription: { label: "Assinaturas", color: "#1bb9d6" },
  credit: { label: "Crédito", color: "#4178ff" },
  template: { label: "Contas fixas", color: "#67e6b7" },
  bill: { label: "Contas avulsas", color: "#ff9f43" },
  charge: { label: "A receber", color: "#9b5cff" },
};
const today = new Date();

let selectedYear = today.getFullYear();
let selectedMonth = today.getMonth();
let activeView = "dashboard";
let activeBillFilter = "all";
let activeReceivableFilter = "all";
let showAllPayables = false;
let showAllReceivables = false;
let state = loadState();
let dom = {};
let calendarItemsByDay = {};
let recurringEditState = null;
let pendingDetailState = null;

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    dueMonth: Number.isInteger(item.dueMonth) ? item.dueMonth : item.startMonth ?? selectedMonth,
    revisions: Array.isArray(item.revisions) ? item.revisions : [],
    description: kind === "charge" ? item.description || "" : undefined,
  };
}

function normalizeTemplateItem(item) {
  let inferredStart = null;

  Object.entries(state.years).forEach(([yearKey, yearData]) => {
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
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

function ensureYear(year) {
  if (!state.years[year]) {
    state.years[year] = { months: {} };
  }
  return state.years[year];
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
  return ensureMonth(selectedYear, selectedMonth);
}

function readMonthData(year, month) {
  return state.years[year]?.months?.[String(month)] || null;
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
    state.charges
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
  return state.charges
    .filter((charge) => (charge.frequency || "monthly") === "once")
    .map((charge) => {
      const occurrenceYear = charge.startYear ?? selectedYear;
      const occurrenceMonth = charge.startMonth ?? selectedMonth;
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
  Object.entries(state.years).forEach(([yearKey, yearData]) => {
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
  const startYear = normalized.startYear ?? selectedYear;
  const startMonth = normalized.startMonth ?? selectedMonth;
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
  const credit = state.credits.find((item) => item.id === creditId);
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
  return getItemsForMonth(selectedYear, selectedMonth);
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
      meta: "Conta avulsa deste mês",
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

  state.subscriptions.forEach((subscription) => {
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

  state.charges.forEach((charge) => {
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

  state.templates.forEach((template) => {
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
    state.templates.forEach((template) => {
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

  state.credits.forEach((credit) => {
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

function calculateMonth(year = selectedYear, month = selectedMonth, options = {}) {
  const monthData = options.create === false ? readMonthData(year, month) : ensureMonth(year, month);
  const items = monthData ? getItemsForMonth(year, month, options) : [];
  const baseSalary =
    !monthData || monthData.baseSalary === null || monthData.baseSalary === undefined
      ? numberValue(state.settings.baseSalary)
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

function setView(view) {
  activeView = view;
  if (view !== "dashboard") {
    showAllPayables = false;
    showAllReceivables = false;
  }
  dom.views.forEach((item) => {
    item.classList.toggle("active", item.id === `${view}-view`);
  });
  dom.navPills.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
}

function render() {
  ensureMonth(selectedYear, selectedMonth);
  renderHeader();
  renderCalendar();
  renderMonthTabs();
  renderDashboard();
  renderSubscriptions();
  renderCharges();
  renderCredits();
  renderTemplates();
  renderAnnual();
  renderSettings();
}

function renderHeader() {
  dom.selectedMonthTitle.textContent = `${monthNames[selectedMonth]} ${selectedYear}`;
  dom.selectedYear.textContent = selectedYear;
  dom.selectedYearCopy.textContent = `Você está vendo ${selectedYear}. Os dados deste ano ficam separados dos outros anos.`;
}

function renderCalendar() {
  const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
  const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
  const isCurrentMonth = today.getFullYear() === selectedYear && today.getMonth() === selectedMonth;
  calendarItemsByDay = getCurrentItems().reduce((days, item) => {
    const day = Math.max(1, Math.min(daysInMonth, item.dueDay));
    days[day] = days[day] || [];
    days[day].push(item);
    return days;
  }, {});

  dom.calendarTitle.textContent = `${monthNames[selectedMonth]} ${selectedYear}`;
  dom.todayChip.textContent = isCurrentMonth ? `Hoje, dia ${today.getDate()}` : "Mês salvo";
  dom.calendarGrid.innerHTML = "";

  weekdayShort.forEach((day) => {
    dom.calendarGrid.insertAdjacentHTML("beforeend", `<div class="calendar-weekday">${day}</div>`);
  });

  for (let blank = 0; blank < firstDay; blank += 1) {
    dom.calendarGrid.insertAdjacentHTML("beforeend", "<div></div>");
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const todayClass = isCurrentMonth && today.getDate() === day ? " today" : "";
    const dayItems = calendarItemsByDay[day] || [];
    const billClass = dayItems.length ? " has-bills" : "";
    const overdueClass = dayItems.some((item) => item.overdue) ? " has-overdue" : "";
    const badge = dayItems.length ? `<span class="calendar-badge">${dayItems.length}</span>` : "";
    dom.calendarGrid.insertAdjacentHTML(
      "beforeend",
      `<button class="calendar-day${todayClass}${billClass}${overdueClass}" data-calendar-day="${day}" type="button">${day}${badge}</button>`,
    );
  }
}

function renderMonthTabs() {
  dom.monthTabs.innerHTML = monthShort
    .map((month, index) => {
      const active = index === selectedMonth ? " active" : "";
      return `<button class="month-tab${active}" data-action="select-month" data-month="${index}">${month}</button>`;
    })
    .join("");
}

function renderDashboard() {
  const summary = calculateMonth();
  const monthData = getMonthData();
  const payableItems = summary.items.filter((item) => item.kind !== "charge");
  const monthReceivableItems = summary.items.filter((item) => item.kind === "charge");
  const oneTimeReceivableHistory = getPaidOneTimeReceivableHistory(selectedYear, selectedMonth, monthReceivableItems);
  const receivableItems = [
    ...monthReceivableItems,
    ...((monthData.extras || []).map((item) => ({
      id: item.id,
      kind: "extra-income",
      title: item.name,
      value: numberValue(item.value),
      dueDay: 99,
      paid: true,
      staticEntry: true,
      meta: `Extra já registrado em ${monthNames[selectedMonth]} ${selectedYear}`,
    })) || []),
  ];
  const filteredItems = buildDisplayItems(filterItems(payableItems));
  const filteredReceivables =
    activeReceivableFilter === "once"
      ? buildDisplayItems(sortMonthItems([...monthReceivableItems.filter((item) => item.recurringFrequency === "once"), ...oneTimeReceivableHistory]))
      : buildDisplayItems(sortMonthItems(receivableItems));
  const limitedPayables = showAllPayables ? filteredItems : filteredItems.slice(0, 5);
  const limitedReceivables = showAllReceivables ? filteredReceivables : filteredReceivables.slice(0, 5);
  const overdueExpenseTotal = calculateOverdueExpenses(summary.items);
  const monthStatusText =
    summary.leftover > 0
      ? `Sobrou ${money(summary.leftover)} neste mês, considerando o que já entrou e o que ainda falta pagar.`
      : summary.leftover < 0
        ? `Este mês está negativo em ${money(Math.abs(summary.leftover))}. Ainda falta cobertura para fechar as contas.`
        : "Este mês está zerado: o que entrou ficou exatamente empatado com o que falta pagar.";

  dom.baseSalary.value =
    monthData.baseSalary === null || monthData.baseSalary === undefined
      ? state.settings.baseSalary || ""
      : monthData.baseSalary || "";
  dom.incomeStatus.textContent = money(summary.income);
  dom.billCount.hidden = true;
  dom.receivableCount.hidden = true;
  dom.monthLeftover.textContent = money(summary.leftover);
  dom.monthResultDescription.textContent = monthStatusText;

  dom.summaryStrip.innerHTML = [
    ["Receita", money(summary.income)],
    ["Total para pagar", money(summary.totalToPay)],
    ["Pendente", money(summary.pending)],
    ["Sobrou", money(summary.leftover)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.miniLedger.innerHTML = [
    ["Total de atrasados", money(overdueExpenseTotal)],
    ["A receber deste mês", money(summary.chargesReceivableCurrent)],
    ["A receber atrasado", money(summary.chargesReceivableOverdue)],
    ["A receber recebido", money(summary.chargesReceived)],
    ["Extras", money(summary.extraIncome)],
    ["Receita do mês", money(summary.income)],
    ["Assinaturas pagas", money(summary.categories.subscription.paid)],
    ["Contas fixas pagas", money(summary.categories.template.paid)],
    ["Contas avulsas pagas", money(summary.categories.bill.paid)],
    ["Total geral pago no mês", money(summary.paid)],
  ]
    .map(([label, value]) => `<div class="ledger-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  renderMonthItems(limitedPayables, filteredItems.length);
  renderReceivableItems(limitedReceivables, filteredReceivables.length);
  renderMonthlyCategoryBreakdown(summary.categories, {
    overdueExpenseTotal,
    receivableUnpaidTotal: summary.chargesReceivable,
    receivableUnpaidCount: summary.categories.charge.pendingCount,
    overdueCount:
      summary.categories.subscription.overdueCount +
      summary.categories.credit.overdueCount +
      summary.categories.template.overdueCount +
      summary.categories.bill.overdueCount +
      summary.categories.charge.overdueCount,
  });
  renderExtras();
}

function renderMonthlyCategoryBreakdown(categories, extras = {}) {
  const cards = Object.values(categories)
    .map(
      (category) => `
        <article class="category-card">
          <span class="category-dot" style="--dot-color: ${category.color}"></span>
          <div>
            <p>${category.label}</p>
            <strong>${money(category.pending)}</strong>
            <small>${
              category.key === "charge"
                ? `${category.count} itens • ${money(category.total)} no total`
                : category.overdueCount
                  ? `${category.overdueCount} atrasados • Total de atrasados ${money(category.overdueTotal)}`
                  : `${category.count} itens • ${money(category.total)} no total`
            }</small>
          </div>
        </article>
      `,
    );

  cards.push(`
    <article class="category-card">
      <span class="category-dot" style="--dot-color: #ef476f"></span>
      <div>
        <p>Total de atrasados</p>
        <strong>${money(extras.overdueExpenseTotal || 0)}</strong>
        <small>${extras.overdueCount || 0} itens atrasados</small>
      </div>
    </article>
  `);

  cards.push(`
    <article class="category-card">
      <span class="category-dot" style="--dot-color: #9b5cff"></span>
      <div>
        <p>A receber não pago</p>
        <strong>${money(extras.receivableUnpaidTotal || 0)}</strong>
        <small>${extras.receivableUnpaidCount || 0} itens não pagos</small>
      </div>
    </article>
  `);

  dom.monthlyCategoryBreakdown.innerHTML = cards.join("");
}

function filterItems(items) {
  if (activeBillFilter === "all") return items;
  return items.filter((item) => item.kind === activeBillFilter);
}

function filterReceivableItems(items) {
  if (activeReceivableFilter === "all") return items;
  if (activeReceivableFilter === "once") {
    return items.filter((item) => item.kind === "charge" && item.recurringFrequency === "once");
  }
  return items;
}

function renderExtras() {
  const monthData = getMonthData();
  monthData.extras = Array.isArray(monthData.extras) ? monthData.extras : [];

  if (!monthData.extras.length) {
    dom.extrasList.innerHTML = `<div class="empty-state">Nenhum extra neste mês ainda.</div>`;
    return;
  }

  dom.extrasList.innerHTML = monthData.extras
    .map(
      (item) => `
        <div class="money-item">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">Entrada extra em ${monthNames[selectedMonth]} ${selectedYear}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <button class="small-action delete" data-action="delete-extra" data-id="${item.id}">Excluir</button>
        </div>
      `,
    )
    .join("");
}

function renderMonthItems(items, totalItems = items.length) {
  if (!items.length) {
    const message =
      totalItems > 0
        ? "Nenhum item encontrado para este filtro."
        : "Nenhuma conta neste mês ainda. Adicione uma conta avulsa, assinatura, conta fixa ou crédito.";
    dom.monthItems.innerHTML = `<div class="empty-state">${message}</div>`;
    dom.monthItemsToggle.hidden = true;
    return;
  }

  dom.monthItems.innerHTML = items
    .map((item) => {
      const statusClass = item.overdue ? "overdue" : item.paid ? "paid" : "";
      const status = item.overdue ? "Atrasada" : item.paid ? "Paga" : "Pendente";
      const titleMarkup = item.group
        ? `<button class="item-link ${item.overdue ? "is-overdue" : ""}" type="button" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">${item.title}</button>`
        : `<p class="item-title ${item.overdue ? "is-overdue" : ""}">${item.title}</p>`;
      const templateValueInput =
        item.kind === "template" && item.manual
          ? `<input type="number" min="0" step="0.01" value="${item.value || ""}" data-action="set-template-value" data-id="${item.id}" aria-label="Valor da conta fixa ${item.title}" />`
          : "";

      return `
        <div class="money-item ${statusClass}">
          <div>
            ${titleMarkup}
            <p class="item-meta">${item.meta} • vence dia ${item.dueDay} • ${status}</p>
            ${templateValueInput}
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <div>
            ${
              item.group
                ? `<button class="small-action" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">Detalhes</button>`
                : `<button class="small-action" data-action="toggle-paid" data-kind="${item.kind}" data-id="${item.id}" data-credit-id="${item.creditId || ""}" data-index="${item.installmentIndex ?? ""}" data-source-kind="${item.sourceKind || ""}" data-source-year="${item.sourceYear ?? ""}" data-source-month="${item.sourceMonth ?? ""}" data-source-id="${item.sourceId || ""}">
              ${item.paid ? "Desmarcar" : "Pagar"}
            </button>`
            }
            ${item.kind === "bill" && !item.sourceKind ? `<button class="small-action delete" data-action="delete-bill" data-id="${item.id}">Excluir</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  const hasOverflow = totalItems > 5;
  dom.monthItemsToggle.hidden = !hasOverflow;
  dom.monthItemsToggle.textContent = showAllPayables ? "▲ Mostrar menos" : "▼ Ver mais";
}

function renderSubscriptions() {
  if (!state.subscriptions.length) {
    dom.subscriptionList.innerHTML = `<div class="empty-state">Nenhuma assinatura cadastrada. Quando adicionar, ela entra em todos os meses automaticamente.</div>`;
    return;
  }

  dom.subscriptionList.innerHTML = state.subscriptions
    .map((item) => {
      const snapshot = getRecurringSnapshot(item, selectedYear, selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${snapshot.name}</p>
            <p class="item-meta">Assinatura ${snapshot.frequency === "annual" ? `anual • ${monthNames[snapshot.dueMonth]}` : "mensal"} • vence dia ${snapshot.dueDay}</p>
          </div>
          <strong class="item-value">${money(snapshot.value)}</strong>
          <div>
            <button class="small-action" data-action="edit-subscription" data-id="${item.id}">Editar</button>
            <button class="small-action delete" data-action="delete-subscription" data-id="${item.id}">Excluir</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderReceivableItems(items, totalItems = items.length) {
  if (!items.length) {
    const message = totalItems > 0 ? "Nenhum item encontrado para este período." : "Nada a receber neste mês.";
    dom.receivableItems.innerHTML = `<div class="empty-state">${message}</div>`;
    dom.receivableItemsToggle.hidden = true;
    return;
  }

  dom.receivableItems.innerHTML = items
    .map((item) => {
      const statusClass = item.overdue ? "overdue" : item.paid ? "paid" : "";
      const status = item.overdue ? "Atrasado" : item.paid ? "Recebido" : "Pendente";
      const titleMarkup = item.group
        ? `<button class="item-link ${item.overdue ? "is-overdue" : ""}" type="button" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">${item.title}</button>`
        : `<p class="item-title ${item.overdue ? "is-overdue" : ""}">${item.title}</p>`;

      return `
        <div class="money-item ${statusClass}">
          <div>
            ${titleMarkup}
            <p class="item-meta">${item.meta}${item.staticEntry ? "" : ` • dia ${item.dueDay}`} • ${status}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <div>
            ${
              item.staticEntry
                ? `<span class="soft-chip">Recebido</span>`
                : item.group
                  ? `<button class="small-action" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">Detalhes</button>`
                : `<button class="small-action" data-action="toggle-paid" data-kind="${item.kind}" data-id="${item.id}" data-source-kind="${item.sourceKind || ""}" data-source-year="${item.sourceYear ?? ""}" data-source-month="${item.sourceMonth ?? ""}" data-source-id="${item.sourceId || ""}">
              ${item.paid ? "Desmarcar" : "Receber"}
            </button>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  const hasOverflow = totalItems > 5;
  dom.receivableItemsToggle.hidden = !hasOverflow;
  dom.receivableItemsToggle.textContent = showAllReceivables ? "▲ Mostrar menos" : "▼ Ver mais";
}

function renderCharges() {
  if (!state.charges.length) {
    dom.chargeList.innerHTML = `<div class="empty-state">Nenhum item a receber cadastrado. Use para pessoas que dividem assinatura ou conta com você.</div>`;
    dom.chargePaidList.innerHTML = `<div class="empty-state">Nenhum pagamento único recebido ainda.</div>`;
    return;
  }

  dom.chargeList.innerHTML = state.charges
    .map((item) => {
      const snapshot = getRecurringSnapshot(item, selectedYear, selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${snapshot.name}</p>
            <p class="item-meta">${snapshot.description} • a receber ${snapshot.frequency === "annual" ? `anual • ${monthNames[snapshot.dueMonth]}` : snapshot.frequency === "once" ? `Pagamento Único • ${monthNames[snapshot.dueMonth ?? selectedMonth]}` : "mensal"} • dia ${snapshot.dueDay}</p>
          </div>
          <strong class="item-value">${money(snapshot.value)}</strong>
          <div>
            <button class="small-action" data-action="edit-charge" data-id="${item.id}">Editar</button>
            <button class="small-action delete" data-action="delete-charge" data-id="${item.id}">Excluir</button>
          </div>
        </div>
      `;
    })
    .join("");

  const paidOneTimeCharges = getAllPaidOneTimeCharges();
  if (!paidOneTimeCharges.length) {
    dom.chargePaidList.innerHTML = `<div class="empty-state">Nenhum pagamento único recebido ainda.</div>`;
    return;
  }

  dom.chargePaidList.innerHTML = paidOneTimeCharges
    .map(
      (item) => `
        <div class="money-item paid">
          <div>
            <p class="item-title">${item.title}</p>
            <p class="item-meta">${item.meta} • dia ${item.dueDay}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <div>
            <button class="small-action" data-action="toggle-paid" data-kind="${item.kind}" data-id="${item.id}" data-source-kind="${item.sourceKind}" data-source-year="${item.sourceYear}" data-source-month="${item.sourceMonth}" data-source-id="${item.sourceId}">
              Desmarcar
            </button>
          </div>
        </div>
      `,
    )
    .join("");
}

function openPendingDetail(groupKey, kind) {
  const allItems = calculateMonth().items;
  const groupedItems = allItems.filter((item) => getItemBaseKey(item) === groupKey && !item.paid);
  if (!groupedItems.length) return;

  pendingDetailState = { groupKey, kind, items: sortMonthItems(groupedItems) };
  const overdueItems = pendingDetailState.items.filter((item) => item.overdue);
  const label = kind === "charge" ? "receber" : "pagar";

  dom.pendingDetailTitle.textContent = pendingDetailState.items[0].title;
  dom.pendingDetailCopy.textContent =
    overdueItems.length > 0
      ? `Existem ${overdueItems.length} pendência(s) atrasada(s). Você pode ${label} uma por vez ou resolver tudo.`
      : `Você pode ${label} cada pendência separadamente.`;

  dom.pendingDetailActions.innerHTML = `
    ${overdueItems.length ? `<button class="small-action" type="button" data-action="resolve-overdue-group">${kind === "charge" ? "Receber atrasadas" : "Pagar atrasadas"}</button>` : ""}
    <button class="primary-button" type="button" data-action="resolve-all-group">${kind === "charge" ? "Receber tudo" : "Pagar tudo"}</button>
  `;

  dom.pendingDetailList.innerHTML = pendingDetailState.items
    .map(
      (item) => `
        <div class="money-item ${item.overdue ? "overdue" : ""}">
          <div>
            <p class="item-title ${item.overdue ? "is-overdue" : ""}">${item.title}</p>
            <p class="item-meta">${item.meta} • vence dia ${item.dueDay} • ${item.overdue ? "Atrasado" : "Pendente"}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <div>
            <button class="small-action" type="button" data-action="resolve-single-pending" data-kind="${item.kind}" data-id="${item.id}" data-credit-id="${item.creditId || ""}" data-index="${item.installmentIndex ?? ""}" data-source-kind="${item.sourceKind || ""}" data-source-year="${item.sourceYear ?? ""}" data-source-month="${item.sourceMonth ?? ""}" data-source-id="${item.sourceId || ""}">
              ${kind === "charge" ? "Receber" : "Pagar"}
            </button>
          </div>
        </div>
      `,
    )
    .join("");

  if (!dom.pendingDetailDialog.open) {
    dom.pendingDetailDialog.showModal();
  }
}

function closePendingDetail() {
  pendingDetailState = null;
  if (dom.pendingDetailDialog?.open) {
    dom.pendingDetailDialog.close();
  }
}

function refreshPendingDetail() {
  if (!pendingDetailState) return;
  const { groupKey, kind } = pendingDetailState;
  const remaining = calculateMonth().items.filter((item) => getItemBaseKey(item) === groupKey && !item.paid);
  if (!remaining.length) {
    closePendingDetail();
    return;
  }
  openPendingDetail(groupKey, kind);
}

function resolvePendingItems(items, overdueOnly = false) {
  const targets = overdueOnly ? items.filter((item) => item.overdue) : items;
  targets.forEach((item) => {
    applyPaidToggle(item.kind, item.id, item.creditId, item.installmentIndex, {
      kind: item.sourceKind,
      year: item.sourceYear,
      month: item.sourceMonth,
      id: item.sourceId,
    });
  });
  saveState();
  render();
  refreshPendingDetail();
}

function renderCredits() {
  if (!state.credits.length) {
    dom.creditList.innerHTML = `<div class="empty-state">Nenhum crédito cadastrado. Use para empréstimos, parcelas e compras longas.</div>`;
    return;
  }

  dom.creditList.innerHTML = state.credits
    .map((credit) => {
      const paidCount = Array.isArray(credit.paid) ? credit.paid.length : 0;
      const remaining = Math.max(0, credit.installments - paidCount);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${credit.name}</p>
            <p class="item-meta">
              ${paidCount}/${credit.installments} parcelas pagas • ${remaining} restantes • vence dia ${credit.dueDay}
            </p>
          </div>
          <strong class="item-value">${money(credit.value)}</strong>
          <button class="small-action delete" data-action="delete-credit" data-id="${credit.id}">Excluir</button>
        </div>
      `;
    })
    .join("");
}

function renderTemplates() {
  if (!state.templates.length) {
    dom.templateList.innerHTML = `<div class="empty-state">Nenhuma conta fixa criada. Cadastre internet, plano de saúde ou qualquer despesa recorrente previsível.</div>`;
    return;
  }

  dom.templateList.innerHTML = state.templates
    .map((item) => {
      const snapshot = getTemplateSnapshot(item, selectedYear, selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${snapshot.name}</p>
            <p class="item-meta">${snapshot.manual ? "Preencher manualmente por mês" : "Valor padrão todo mês"} • vence dia ${snapshot.dueDay}</p>
          </div>
          <strong class="item-value">${snapshot.manual ? "Manual" : money(snapshot.value)}</strong>
          <button class="small-action delete" data-action="delete-template" data-id="${item.id}">Excluir</button>
        </div>
      `;
    })
    .join("");
}

function getAnnualMonths() {
  if (selectedYear < today.getFullYear()) {
    return Array.from({ length: 12 }, (_, index) => index);
  }

  if (selectedYear === today.getFullYear()) {
    return Array.from({ length: today.getMonth() + 1 }, (_, index) => index);
  }

  return Array.from({ length: 12 }, (_, index) => index).filter((month) => monthHasData(selectedYear, month));
}

function calculateAnnual() {
  const months = getAnnualMonths().map((month) => ({
    month,
    summary: calculateMonth(selectedYear, month, { create: false }),
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
  Object.entries(state.years).forEach(([yearKey, yearData]) => {
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

function calculateAnnualOverview() {
  const months = getAnnualMonths();
  const monthSet = new Set(months);
  const yearEndMonth = months.length ? months[months.length - 1] : selectedMonth;
  const yearEndIndex = getMonthIndex(selectedYear, yearEndMonth);
  const currentIndex = getMonthIndex(today.getFullYear(), today.getMonth());

  let salaryTotal = 0;
  let extrasTotal = 0;
  let fixedPaidTotal = 0;
  let fixedPendingTotal = 0;
  let manualPaidTotal = 0;
  let manualPendingTotal = 0;

  months.forEach((month) => {
    const monthSummary = calculateMonth(selectedYear, month, { create: false });
    const data = readMonthData(selectedYear, month);

    salaryTotal += monthSummary.baseSalary;
    extrasTotal += monthSummary.extraIncome;

    (data?.bills || []).forEach((bill) => {
      if (bill.paid) {
        manualPaidTotal += numberValue(bill.value);
      } else {
        manualPendingTotal += numberValue(bill.value);
      }
    });

    state.templates.forEach((item) => {
      const snapshot = getTemplateSnapshot(item, selectedYear, month);
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

  state.subscriptions.forEach((item) => {
    getRecurringOccurrenceMonths(item, selectedYear, yearEndMonth)
      .filter((occurrence) => occurrence.year === selectedYear && monthSet.has(occurrence.month))
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

  state.charges.forEach((item) => {
    getRecurringOccurrenceMonths(item, selectedYear, yearEndMonth)
      .filter((occurrence) => occurrence.year === selectedYear && monthSet.has(occurrence.month))
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

  const creditBorrowed = state.credits.reduce((sum, credit) => sum + numberValue(credit.value) * numberValue(credit.installments), 0);
  const creditPaid = state.credits.reduce(
    (sum, credit) => sum + numberValue(credit.value) * (Array.isArray(credit.paid) ? credit.paid.length : 0),
    0,
  );
  const creditRemaining = creditBorrowed - creditPaid;
  const revenueTotal = salaryTotal + extrasTotal + chargesReceivedTotal;
  const activeSubscriptions = state.subscriptions.filter((item) => getMonthIndex(item.startYear ?? today.getFullYear(), item.startMonth ?? 0) <= currentIndex);
  const subscriptionTotalValue = activeSubscriptions.reduce(
    (sum, item) => sum + numberValue(getRecurringSnapshot(item, today.getFullYear(), today.getMonth()).value),
    0,
  );
  const subscriptionActiveCount = state.subscriptions.filter((item) => getMonthIndex(item.startYear ?? selectedYear, item.startMonth ?? 0) <= yearEndIndex).length;
  const receivableActiveCount = state.charges.filter((item) => getMonthIndex(item.startYear ?? selectedYear, item.startMonth ?? 0) <= yearEndIndex).length;
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
    templateCount: state.templates.length,
    creditCount: state.credits.length,
    totalPaidOut,
    totalPendingToPay,
    overallLeft,
  };
}

function renderAnnual() {
  const annual = calculateAnnual();
  const annualOverview = calculateAnnualOverview();
  const monthLimit = annual.months.length;
  const maxMonthSpend = Math.max(...annual.months.map((entry) => entry.summary.totalToPay), 1);
  const categoryEntries = Object.values(annual.categories).filter((category) => category.key !== "charge");
  const categoryTotal = categoryEntries.reduce((sum, category) => sum + category.total, 0);
  let currentPercent = 0;
  const pieParts = categoryEntries.map((category) => {
    const percent = categoryTotal ? (category.total / categoryTotal) * 100 : 0;
    const start = currentPercent;
    currentPercent += percent;
    return `${category.color} ${start}% ${currentPercent}%`;
  });

  dom.annualTitle.textContent = `Resultado anual`;
  dom.annualSubtitle.textContent =
    selectedYear > today.getFullYear() && monthLimit === 0
      ? `O ano selecionado é ${selectedYear}, mas ainda não há dados preenchidos para esse período.`
      : selectedYear > today.getFullYear()
        ? `Ano selecionado: ${selectedYear}. Receita, assinaturas e contas consideram esse ano; créditos mostram o total contratado no sistema.`
        : selectedYear === today.getFullYear()
          ? `Ano selecionado: ${selectedYear}. O resumo considera de Janeiro até ${monthNames[monthLimit - 1]} e os créditos continuam globais.`
          : `Ano selecionado: ${selectedYear}. O resumo considera Janeiro até Dezembro; créditos mostram o total contratado no sistema.`;

  dom.annualRevenueCopy.textContent = `Tudo o que entrou no ano selecionado até agora, incluindo salário, extras e valores recebidos.`;
  dom.annualRevenueSummary.innerHTML = [
    ["Receita total", money(annualOverview.revenueTotal)],
    ["Salário total recebido", money(annualOverview.salaryTotal)],
    ["Extra total recebido", money(annualOverview.extrasTotal)],
    ["A receber total recebido", money(annualOverview.chargesReceivedTotal)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.annualSubscriptionCopy.textContent = `Mostra o valor atual somado das assinaturas ativas no sistema e o quanto já foi pago delas no ano selecionado.`;
  dom.annualSubscriptionSummary.innerHTML = [
    ["Total de assinaturas", money(annualOverview.subscriptionTotalValue)],
    ["Assinaturas total pagas", money(annualOverview.subscriptionsPaidTotal)],
    ["Assinaturas total ativas", `${annualOverview.subscriptionActiveCount}`],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.annualCreditCopy.textContent = `Créditos ignoram o ano selecionado e mostram o total contratado no sistema inteiro, mesmo que durem vários anos.`;
  dom.annualCreditSummary.innerHTML = [
    ["Crédito total contratado", money(annualOverview.creditBorrowed)],
    ["Crédito total já pago", money(annualOverview.creditPaid)],
    ["Crédito total a pagar", money(annualOverview.creditRemaining)],
    ["Créditos ativos", `${annualOverview.creditCount}`],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.annualPie.style.background = categoryTotal
    ? `conic-gradient(${pieParts.join(", ")})`
    : "conic-gradient(rgba(255,255,255,0.6) 0% 100%)";

  dom.annualLegend.innerHTML = categoryEntries
    .map(
      (category) => `
        <div class="legend-row">
          <span class="category-dot" style="--dot-color: ${category.color}"></span>
          <span>${category.label}</span>
          <strong>${money(category.total)}</strong>
        </div>
      `,
    )
    .join("");

  dom.annualBars.innerHTML = annual.months
    .map((entry) => {
      const height = Math.max(8, (entry.summary.totalToPay / maxMonthSpend) * 100);
      return `
        <div class="bar-column" title="${monthNames[entry.month]}: ${money(entry.summary.totalToPay)}">
          <div class="bar-track">
            <span style="height: ${height}%"></span>
          </div>
          <small>${monthShort[entry.month]}</small>
        </div>
      `;
    })
    .join("") || `<div class="empty-state">Nenhum mês preenchido para este ano ainda.</div>`;

  dom.annualMonthList.innerHTML = annual.months
    .map((entry) => {
      const chargeOpen = entry.summary.chargesReceivable;
      return `
        <div class="annual-month-row">
          <div class="annual-month-main">
            <strong>${monthNames[entry.month]}</strong>
            <small>${entry.summary.items.length} itens lançados no mês selecionado</small>
          </div>
          <div class="annual-month-stat">
            <span>Receita</span>
            <strong>${money(entry.summary.income)}</strong>
          </div>
          <div class="annual-month-stat">
            <span>Pago</span>
            <strong>${money(entry.summary.paid)}</strong>
          </div>
          <div class="annual-month-stat">
            <span>Pendente</span>
            <strong>${money(entry.summary.pending)}</strong>
          </div>
          <div class="annual-month-stat">
            <span>A receber</span>
            <strong>${money(chargeOpen)}</strong>
          </div>
          <div class="annual-month-stat">
            <span>Sobrou</span>
            <strong>${money(entry.summary.leftover)}</strong>
          </div>
        </div>
      `;
    })
    .join("") || `<div class="empty-state">Quando você preencher algum mês deste ano, ele aparece aqui.</div>`;
}

function renderSettings() {
  dom.settingsSalary.value = state.settings.baseSalary || "";
}

function populateMonthSelect(select) {
  select.innerHTML = monthNames.map((month, index) => `<option value="${index}">${month}</option>`).join("");
}

function toggleMonthField(select, wrap, monthSelect, allowOnce = false) {
  const shouldShow = select.value === "annual" || (allowOnce && select.value === "once");
  wrap.classList.toggle("is-hidden", !shouldShow);
  if (shouldShow && (monthSelect.value === "" || monthSelect.value === undefined)) {
    monthSelect.value = String(selectedMonth);
  }
}

function configureEditFrequencyOptions(kind) {
  const onceOption = dom.editFrequency.querySelector('option[value="once"]');
  if (!onceOption) return;
  onceOption.hidden = kind !== "charge";
  if (kind !== "charge" && dom.editFrequency.value === "once") {
    dom.editFrequency.value = "monthly";
  }
}

function openRecurringEdit(kind, id) {
  const collection = kind === "subscription" ? state.subscriptions : state.charges;
  const item = collection.find((entry) => entry.id === id);
  if (!item) return;

  const snapshot = getRecurringSnapshot(item, selectedYear, selectedMonth);
  recurringEditState = { kind, id };
  dom.editDialogTitle.textContent = kind === "subscription" ? "Editar assinatura" : "Editar item a receber";
  dom.editDescriptionWrap.classList.toggle("is-hidden", kind !== "charge");
  configureEditFrequencyOptions(kind);
  dom.editName.value = snapshot.name;
  dom.editDescription.value = snapshot.description || "";
  dom.editValue.value = snapshot.value;
  dom.editFrequency.value = snapshot.frequency || "monthly";
  dom.editMonth.value = String(snapshot.dueMonth ?? selectedMonth);
  dom.editDay.value = snapshot.dueDay;
  dom.editEffectiveMonth.textContent = `${monthNames[selectedMonth]} ${selectedYear}`;
  toggleMonthField(dom.editFrequency, dom.editMonthWrap, dom.editMonth, kind === "charge");
  dom.recurringEditDialog.showModal();
}

function cacheDom() {
  dom = {
    views: document.querySelectorAll(".view"),
    navPills: document.querySelectorAll(".nav-pill"),
    filterPills: document.querySelectorAll("[data-filter]"),
    receivableFilterPills: document.querySelectorAll("[data-receivable-filter]"),
    selectedMonthTitle: document.getElementById("selected-month-title"),
    selectedYear: document.getElementById("selected-year"),
    selectedYearCopy: document.getElementById("selected-year-copy"),
    calendarGrid: document.getElementById("calendar-grid"),
    calendarPopover: document.getElementById("calendar-popover"),
    calendarTitle: document.getElementById("calendar-title"),
    todayChip: document.getElementById("today-chip"),
    monthTabs: document.getElementById("month-tabs"),
    baseSalary: document.getElementById("base-salary"),
    incomeStatus: document.getElementById("income-status"),
    billCount: document.getElementById("bill-count"),
    receivableCount: document.getElementById("receivable-count"),
    monthLeftover: document.getElementById("month-leftover"),
    monthResultDescription: document.getElementById("month-result-description"),
    summaryStrip: document.getElementById("summary-strip"),
    miniLedger: document.getElementById("mini-ledger"),
    monthItems: document.getElementById("month-items"),
    monthItemsToggle: document.getElementById("month-items-toggle"),
    receivableItems: document.getElementById("receivable-items"),
    receivableItemsToggle: document.getElementById("receivable-items-toggle"),
    monthlyCategoryBreakdown: document.getElementById("monthly-category-breakdown"),
    extrasList: document.getElementById("extras-list"),
    subscriptionList: document.getElementById("subscription-list"),
    chargeList: document.getElementById("charge-list"),
    chargePaidList: document.getElementById("charge-paid-list"),
    creditList: document.getElementById("credit-list"),
    templateList: document.getElementById("template-list"),
    annualTitle: document.getElementById("annual-title"),
    annualSubtitle: document.getElementById("annual-subtitle"),
    annualRevenueCopy: document.getElementById("annual-revenue-copy"),
    annualRevenueSummary: document.getElementById("annual-revenue-summary"),
    annualSubscriptionCopy: document.getElementById("annual-subscription-copy"),
    annualSubscriptionSummary: document.getElementById("annual-subscription-summary"),
    annualCreditCopy: document.getElementById("annual-credit-copy"),
    annualCreditSummary: document.getElementById("annual-credit-summary"),
    annualPie: document.getElementById("annual-pie"),
    annualLegend: document.getElementById("annual-legend"),
    annualBars: document.getElementById("annual-bars"),
    annualMonthList: document.getElementById("annual-month-list"),
    settingsSalary: document.getElementById("settings-salary"),
    backupFileInput: document.getElementById("backup-file-input"),
    subscriptionFrequency: document.getElementById("subscription-frequency"),
    subscriptionMonthWrap: document.getElementById("subscription-month-wrap"),
    subscriptionMonth: document.getElementById("subscription-month"),
    chargeFrequency: document.getElementById("charge-frequency"),
    chargeMonthWrap: document.getElementById("charge-month-wrap"),
    chargeMonth: document.getElementById("charge-month"),
    recurringEditDialog: document.getElementById("recurring-edit-dialog"),
    recurringEditForm: document.getElementById("recurring-edit-form"),
    editDialogTitle: document.getElementById("edit-dialog-title"),
    editName: document.getElementById("edit-name"),
    editDescriptionWrap: document.getElementById("edit-description-wrap"),
    editDescription: document.getElementById("edit-description"),
    editValue: document.getElementById("edit-value"),
    editFrequency: document.getElementById("edit-frequency"),
    editMonthWrap: document.getElementById("edit-month-wrap"),
    editMonth: document.getElementById("edit-month"),
    editDay: document.getElementById("edit-day"),
    editEffectiveMonth: document.getElementById("edit-effective-month"),
    editCancel: document.getElementById("edit-cancel"),
    pendingDetailDialog: document.getElementById("pending-detail-dialog"),
    pendingDetailTitle: document.getElementById("pending-detail-title"),
    pendingDetailCopy: document.getElementById("pending-detail-copy"),
    pendingDetailActions: document.getElementById("pending-detail-actions"),
    pendingDetailList: document.getElementById("pending-detail-list"),
    pendingDetailClose: document.getElementById("pending-detail-close"),
  };
}

function applyPaidToggle(kind, id, creditId, installmentIndex, source = {}) {
  const isLate = Boolean(source.kind && source.year !== "" && source.month !== "" && source.id);
  const monthData = isLate ? ensureMonth(Number(source.year), Number(source.month)) : getMonthData();
  const targetKind = isLate ? source.kind : kind;
  const targetId = isLate ? source.id : id;

  if (targetKind === "bill") {
    const bill = monthData.bills.find((item) => item.id === targetId);
    if (bill) bill.paid = !bill.paid;
  }

  if (targetKind === "subscription") {
    monthData.subscriptionPaid[targetId] = !monthData.subscriptionPaid[targetId];
  }

  if (targetKind === "charge") {
    monthData.chargePaid = monthData.chargePaid || {};
    monthData.chargePaid[targetId] = !monthData.chargePaid[targetId];
  }

  if (targetKind === "template") {
    const saved = monthData.templateValues[targetId] || {};
    saved.paid = !saved.paid;
    monthData.templateValues[targetId] = saved;
  }

  if (targetKind === "credit") {
    const index = Number(installmentIndex);
    const credit = state.credits.find((item) => item.id === creditId);
    const nextValue = credit ? !isCreditInstallmentPaid(credit, index) : false;
    setCreditInstallmentPaid(creditId, index, nextValue, false);
  }
}

function togglePaid(kind, id, creditId, installmentIndex, source = {}) {
  applyPaidToggle(kind, id, creditId, installmentIndex, source);
  saveState();
  render();
}

function showCalendarPopover(day, target) {
  const items = calendarItemsByDay[day] || [];
  if (!items.length) {
    hideCalendarPopover();
    return;
  }

  dom.calendarPopover.innerHTML = `
    <strong>Dia ${day} • ${items.length} item${items.length > 1 ? "s" : ""}</strong>
    ${items
      .map(
        (item) => `
          <div class="calendar-popover-item">
            <span>${item.title}</span>
            <span>${money(item.value)}</span>
          </div>
        `,
      )
      .join("")}
  `;

  const cardRect = target.closest(".calendar-card").getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const left = Math.min(targetRect.left - cardRect.left, cardRect.width - 290);
  dom.calendarPopover.style.left = `${Math.max(12, left)}px`;
  dom.calendarPopover.style.top = `${targetRect.bottom - cardRect.top + 10}px`;
  dom.calendarPopover.hidden = false;
}

function hideCalendarPopover() {
  dom.calendarPopover.hidden = true;
}

function bindEvents() {
  populateMonthSelect(dom.subscriptionMonth);
  populateMonthSelect(dom.chargeMonth);
  populateMonthSelect(dom.editMonth);
  dom.subscriptionMonth.value = String(selectedMonth);
  dom.chargeMonth.value = String(selectedMonth);
  toggleMonthField(dom.subscriptionFrequency, dom.subscriptionMonthWrap, dom.subscriptionMonth);
  toggleMonthField(dom.chargeFrequency, dom.chargeMonthWrap, dom.chargeMonth, true);
  configureEditFrequencyOptions("subscription");

  dom.navPills.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  dom.filterPills.forEach((button) => {
    button.addEventListener("click", () => {
      activeBillFilter = button.dataset.filter;
      showAllPayables = false;
      showAllReceivables = false;
      dom.filterPills.forEach((item) => item.classList.toggle("active", item === button));
      renderDashboard();
    });
  });

  dom.receivableFilterPills.forEach((button) => {
    button.addEventListener("click", () => {
      activeReceivableFilter = button.dataset.receivableFilter;
      showAllReceivables = false;
      dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item === button));
      renderDashboard();
    });
  });

  document.addEventListener("click", (event) => {
    const calendarDay = event.target.closest("[data-calendar-day]");
    if (calendarDay) {
      showCalendarPopover(calendarDay.dataset.calendarDay, calendarDay);
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;

    if (action === "prev-year") {
      selectedYear -= 1;
      showAllPayables = false;
      showAllReceivables = false;
      activeReceivableFilter = "all";
      dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
      render();
    }

    if (action === "next-year") {
      selectedYear += 1;
      showAllPayables = false;
      showAllReceivables = false;
      activeReceivableFilter = "all";
      dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
      render();
    }

    if (action === "select-month") {
      selectedMonth = Number(button.dataset.month);
      showAllPayables = false;
      showAllReceivables = false;
      activeReceivableFilter = "all";
      dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
      render();
    }

    if (action === "toggle-paid") {
      togglePaid(button.dataset.kind, button.dataset.id, button.dataset.creditId, button.dataset.index, {
        kind: button.dataset.sourceKind,
        year: button.dataset.sourceYear,
        month: button.dataset.sourceMonth,
        id: button.dataset.sourceId,
      });
    }

    if (action === "open-pending-detail") {
      openPendingDetail(button.dataset.groupKey, button.dataset.kind);
    }

    if (action === "resolve-overdue-group" && pendingDetailState) {
      resolvePendingItems(pendingDetailState.items, true);
    }

    if (action === "resolve-all-group" && pendingDetailState) {
      resolvePendingItems(pendingDetailState.items);
    }

    if (action === "resolve-single-pending") {
      applyPaidToggle(button.dataset.kind, button.dataset.id, button.dataset.creditId, button.dataset.index, {
        kind: button.dataset.sourceKind,
        year: button.dataset.sourceYear,
        month: button.dataset.sourceMonth,
        id: button.dataset.sourceId,
      });
      saveState();
      render();
      refreshPendingDetail();
    }

    if (action === "delete-bill") {
      const monthData = getMonthData();
      monthData.bills = monthData.bills.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-extra") {
      const monthData = getMonthData();
      monthData.extras = (monthData.extras || []).filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-subscription") {
      state.subscriptions = state.subscriptions.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-charge") {
      state.charges = state.charges.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "edit-subscription") {
      openRecurringEdit("subscription", button.dataset.id);
    }

    if (action === "edit-charge") {
      openRecurringEdit("charge", button.dataset.id);
    }

    if (action === "delete-credit") {
      state.credits = state.credits.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-template") {
      state.templates = state.templates.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "reset-data") {
      const confirmed = window.confirm("Tem certeza que deseja apagar todos os dados salvos?");
      if (!confirmed) return;
      state = createDefaultState();
      saveState();
      render();
    }

    if (action === "use-default-salary") {
      const monthData = getMonthData();
      monthData.baseSalary = numberValue(state.settings.baseSalary);
      saveState();
      render();
    }

    if (action === "export-backup") {
      exportBackup();
    }

    if (action === "import-backup") {
      dom.backupFileInput.click();
    }
  });

  dom.calendarGrid.addEventListener("mouseover", (event) => {
    const calendarDay = event.target.closest("[data-calendar-day]");
    if (!calendarDay) return;
    showCalendarPopover(calendarDay.dataset.calendarDay, calendarDay);
  });

  dom.calendarGrid.addEventListener("mouseleave", () => {
    window.setTimeout(() => {
      if (!dom.calendarPopover.matches(":hover")) hideCalendarPopover();
    }, 120);
  });

  dom.calendarPopover.addEventListener("mouseleave", hideCalendarPopover);

  dom.subscriptionFrequency.addEventListener("change", () => {
    toggleMonthField(dom.subscriptionFrequency, dom.subscriptionMonthWrap, dom.subscriptionMonth);
  });

  dom.chargeFrequency.addEventListener("change", () => {
    toggleMonthField(dom.chargeFrequency, dom.chargeMonthWrap, dom.chargeMonth, true);
  });

  dom.editFrequency.addEventListener("change", () => {
    toggleMonthField(dom.editFrequency, dom.editMonthWrap, dom.editMonth, recurringEditState?.kind === "charge");
  });

  dom.editCancel.addEventListener("click", () => {
    dom.recurringEditDialog.close();
  });

  dom.pendingDetailClose.addEventListener("click", () => {
    closePendingDetail();
  });

  dom.pendingDetailDialog.addEventListener("close", () => {
    pendingDetailState = null;
  });

  dom.monthItemsToggle.addEventListener("click", () => {
    showAllPayables = !showAllPayables;
    renderDashboard();
  });

  dom.receivableItemsToggle.addEventListener("click", () => {
    showAllReceivables = !showAllReceivables;
    renderDashboard();
  });

  document.addEventListener("change", (event) => {
    const input = event.target.closest("[data-action='set-template-value']");
    if (!input) return;
    const monthData = getMonthData();
    const saved = monthData.templateValues[input.dataset.id] || {};
    saved.value = numberValue(input.value);
    monthData.templateValues[input.dataset.id] = saved;
    saveState();
    render();
  });

  document.getElementById("income-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const monthData = getMonthData();
    monthData.baseSalary = numberValue(dom.baseSalary.value);
    saveState();
    render();
  });

  document.getElementById("extra-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const monthData = getMonthData();
    monthData.extras = Array.isArray(monthData.extras) ? monthData.extras : [];
    monthData.extras.push({
      id: uid("extra"),
      name: document.getElementById("extra-name").value.trim(),
      value: numberValue(document.getElementById("extra-value").value),
    });
    event.target.reset();
    dom.subscriptionFrequency.value = "monthly";
    dom.subscriptionMonth.value = String(selectedMonth);
    toggleMonthField(dom.subscriptionFrequency, dom.subscriptionMonthWrap, dom.subscriptionMonth);
    saveState();
    render();
  });

  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.baseSalary = numberValue(dom.settingsSalary.value);
    saveState();
    setView("dashboard");
    render();
  });

  dom.backupFileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      state = normalizeImportedState(parsed);
      saveState();
      render();
      alert("Backup importado com sucesso.");
    } catch (error) {
      alert(error instanceof Error ? error.message : "Não foi possível importar o backup.");
    } finally {
      event.target.value = "";
    }
  });

  document.getElementById("bill-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const monthData = getMonthData();
    monthData.bills.push({
      id: uid("bill"),
      name: document.getElementById("bill-name").value.trim(),
      value: numberValue(document.getElementById("bill-value").value),
      dueDay: clampDay(document.getElementById("bill-day").value),
      paid: false,
    });
    event.target.reset();
    saveState();
    render();
  });

  document.getElementById("subscription-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.subscriptions.push({
      id: uid("subscription"),
      name: document.getElementById("subscription-name").value.trim(),
      value: numberValue(document.getElementById("subscription-value").value),
      dueDay: clampDay(document.getElementById("subscription-day").value),
      frequency: document.getElementById("subscription-frequency").value,
      dueMonth:
        document.getElementById("subscription-frequency").value === "annual"
          ? Number(document.getElementById("subscription-month").value)
          : null,
      startYear: selectedYear,
      startMonth: selectedMonth,
      revisions: [],
    });
    event.target.reset();
    saveState();
    render();
  });

  document.getElementById("charge-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.charges.push({
      id: uid("charge"),
      name: document.getElementById("charge-name").value.trim(),
      description: document.getElementById("charge-description").value.trim(),
      value: numberValue(document.getElementById("charge-value").value),
      dueDay: clampDay(document.getElementById("charge-day").value),
      frequency: document.getElementById("charge-frequency").value,
      dueMonth:
        document.getElementById("charge-frequency").value === "annual" || document.getElementById("charge-frequency").value === "once"
          ? Number(document.getElementById("charge-month").value)
          : null,
      startYear: selectedYear,
      startMonth:
        document.getElementById("charge-frequency").value === "once"
          ? Number(document.getElementById("charge-month").value)
          : selectedMonth,
      revisions: [],
    });
    event.target.reset();
    dom.chargeFrequency.value = "monthly";
    dom.chargeMonth.value = String(selectedMonth);
    toggleMonthField(dom.chargeFrequency, dom.chargeMonthWrap, dom.chargeMonth, true);
    saveState();
    render();
  });

  dom.recurringEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!recurringEditState) return;

    const collection = recurringEditState.kind === "subscription" ? state.subscriptions : state.charges;
    const item = collection.find((entry) => entry.id === recurringEditState.id);
    if (!item) return;

    upsertRecurringRevision(
      item,
      {
        name: dom.editName.value.trim(),
        description: recurringEditState.kind === "charge" ? dom.editDescription.value.trim() : undefined,
        value: dom.editValue.value,
        dueDay: dom.editDay.value,
        dueMonth: dom.editMonth.value,
        frequency: dom.editFrequency.value,
      },
      selectedYear,
      selectedMonth,
    );

    dom.recurringEditDialog.close();
    recurringEditState = null;
    saveState();
    render();
  });

  document.getElementById("credit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.credits.push({
      id: uid("credit"),
      name: document.getElementById("credit-name").value.trim(),
      value: numberValue(document.getElementById("credit-value").value),
      installments: Math.max(1, Math.round(numberValue(document.getElementById("credit-installments").value))),
      dueDay: clampDay(document.getElementById("credit-day").value),
      startYear: selectedYear,
      startMonth: selectedMonth,
      paid: [],
    });
    event.target.reset();
    saveState();
    render();
  });

  document.getElementById("template-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.templates.push({
      id: uid("template"),
      name: document.getElementById("template-name").value.trim(),
      value: numberValue(document.getElementById("template-value").value),
      dueDay: clampDay(document.getElementById("template-day").value),
      manual: document.getElementById("template-manual").checked,
      startYear: selectedYear,
      startMonth: selectedMonth,
    });
    event.target.reset();
    saveState();
    render();
  });
}

cacheDom();
bindEvents();
render();
setView(activeView);
