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
  template: { label: "Caixas", color: "#67e6b7" },
  bill: { label: "Contas", color: "#ff9f43" },
  charge: { label: "Cobranças", color: "#9b5cff" },
};
const today = new Date();

let selectedYear = today.getFullYear();
let selectedMonth = today.getMonth();
let activeView = "dashboard";
let activeBillFilter = "all";
let state = loadState();
let dom = {};
let calendarItemsByDay = {};

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

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const frequency = item.frequency || "monthly";
  const startYear = item.startYear ?? selectedYear;
  const startMonth = item.startMonth ?? selectedMonth;
  const diff = monthsBetween(startYear, startMonth, year, month);
  if (diff < 0) return false;
  return frequency === "annual" ? month === startMonth : true;
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

function setCreditInstallmentPaid(creditId, index, paid) {
  const credit = state.credits.find((item) => item.id === creditId);
  if (!credit) return;
  credit.paid = Array.isArray(credit.paid) ? credit.paid : [];
  if (paid && !credit.paid.includes(index)) {
    credit.paid.push(index);
  }
  if (!paid) {
    credit.paid = credit.paid.filter((item) => item !== index);
  }
  saveState();
  render();
}

function getCurrentItems() {
  return getItemsForMonth(selectedYear, selectedMonth);
}

function getItemsForMonth(year, month, options = {}) {
  const monthData = options.create === false ? readMonthData(year, month) : ensureMonth(year, month);
  if (!monthData) return [];
  const items = [];
  const pastMonths = getPastMonthRefs(year, month);

  monthData.bills.forEach((bill) => {
    items.push({
      id: bill.id,
      kind: "bill",
      title: bill.name,
      value: numberValue(bill.value),
      dueDay: bill.dueDay,
      paid: Boolean(bill.paid),
      meta: "Conta manual deste mês",
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
    if (!isRecurringDue(subscription, year, month)) return;
    const paid = Boolean(monthData.subscriptionPaid[subscription.id]);
    items.push({
      id: subscription.id,
      kind: "subscription",
      title: subscription.name,
      value: numberValue(subscription.value),
      dueDay: subscription.dueDay,
      paid,
      meta: "Assinatura automática",
    });
  });

  pastMonths.forEach((past) => {
    state.subscriptions.forEach((subscription) => {
      if (!isRecurringDue(subscription, past.year, past.month)) return;
      if (past.data.subscriptionPaid?.[subscription.id]) return;
      items.push({
        id: `late-subscription:${past.year}:${past.month}:${subscription.id}`,
        kind: "subscription",
        sourceKind: "subscription",
        sourceYear: past.year,
        sourceMonth: past.month,
        sourceId: subscription.id,
        title: subscription.name,
        value: numberValue(subscription.value),
        dueDay: subscription.dueDay,
        paid: false,
        overdue: true,
        meta: `Assinatura atrasada de ${monthNames[past.month]} ${past.year}`,
      });
    });
  });

  state.charges.forEach((charge) => {
    if (!isRecurringDue(charge, year, month)) return;
    const paid = Boolean(monthData.chargePaid?.[charge.id]);
    items.push({
      id: charge.id,
      kind: "charge",
      title: charge.name,
      value: numberValue(charge.value),
      dueDay: charge.dueDay,
      paid,
      meta: `${charge.description} • cobrança ${charge.frequency === "annual" ? "anual" : "mensal"}`,
    });
  });

  pastMonths.forEach((past) => {
    state.charges.forEach((charge) => {
      if (!isRecurringDue(charge, past.year, past.month)) return;
      if (past.data.chargePaid?.[charge.id]) return;
      items.push({
        id: `late-charge:${past.year}:${past.month}:${charge.id}`,
        kind: "charge",
        sourceKind: "charge",
        sourceYear: past.year,
        sourceMonth: past.month,
        sourceId: charge.id,
        title: charge.name,
        value: numberValue(charge.value),
        dueDay: charge.dueDay,
        paid: false,
        overdue: true,
        meta: `Cobrança atrasada de ${monthNames[past.month]} ${past.year} • ${charge.description}`,
      });
    });
  });

  state.templates.forEach((template) => {
    const saved = monthData.templateValues[template.id] || {};
    const value = template.manual ? numberValue(saved.value) : numberValue(saved.value ?? template.value);
    items.push({
      id: template.id,
      kind: "template",
      title: template.name,
      value,
      dueDay: template.dueDay,
      paid: Boolean(saved.paid),
      meta: template.manual ? "Caixa variável preenchida no mês" : "Caixa recorrente com valor padrão",
      manual: template.manual,
    });
  });

  pastMonths.forEach((past) => {
    state.templates.forEach((template) => {
      const saved = past.data.templateValues?.[template.id] || {};
      if (saved.paid) return;
      const value = template.manual ? numberValue(saved.value) : numberValue(saved.value ?? template.value);
      if (template.manual && !value) return;
      items.push({
        id: `late-template:${past.year}:${past.month}:${template.id}`,
        kind: "template",
        sourceKind: "template",
        sourceYear: past.year,
        sourceMonth: past.month,
        sourceId: template.id,
        title: template.name,
        value,
        dueDay: template.dueDay,
        paid: false,
        overdue: true,
        meta: `Caixa atrasada de ${monthNames[past.month]} ${past.year}`,
      });
    });
  });

  state.credits.forEach((credit) => {
    getCreditInstallmentsForMonth(credit, year, month).forEach((installment) => {
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
          overdue: installment.overdue,
          meta: `Parcela ${installment.number}/${credit.installments}${installment.overdue ? " atrasada" : ""}`,
        });
      }
    });
  });

  return items.sort((a, b) => a.dueDay - b.dueDay);
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
    }
  });

  return categories;
}

function setView(view) {
  activeView = view;
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
  const filteredItems = filterItems(summary.items);

  dom.baseSalary.value =
    monthData.baseSalary === null || monthData.baseSalary === undefined
      ? state.settings.baseSalary || ""
      : monthData.baseSalary || "";
  dom.incomeStatus.textContent = money(summary.income);
  dom.billCount.textContent =
    activeBillFilter === "all"
      ? `${summary.items.length} itens`
      : `${filteredItems.length} de ${summary.items.length} itens`;
  dom.monthLeftover.textContent = money(summary.leftover);

  dom.summaryStrip.innerHTML = [
    ["Salário + extras", money(summary.baseSalary + summary.extraIncome)],
    ["Total para pagar", money(summary.totalToPay)],
    ["A receber", money(summary.chargesReceivable)],
    ["Pendente", money(summary.pending)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.miniLedger.innerHTML = [
    ["Salário base", money(summary.baseSalary)],
    ["Extras", money(summary.extraIncome)],
    ["Cobranças recebidas", money(summary.chargesReceived)],
    ["Cobranças a receber", money(summary.chargesReceivable)],
    ["Pago/marcado", money(summary.paid)],
    ["Ainda falta", money(summary.pending)],
  ]
    .map(([label, value]) => `<div class="ledger-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  renderMonthItems(filteredItems, summary.items.length);
  renderMonthlyCategoryBreakdown(summary.categories);
  renderExtras();
}

function renderMonthlyCategoryBreakdown(categories) {
  dom.monthlyCategoryBreakdown.innerHTML = Object.values(categories)
    .map(
      (category) => `
        <article class="category-card">
          <span class="category-dot" style="--dot-color: ${category.color}"></span>
          <div>
            <p>${category.label}</p>
            <strong>${money(category.pending)}</strong>
            <small>${category.count} itens • ${category.key === "charge" ? "a receber" : `${money(category.total)} no total`}</small>
          </div>
        </article>
      `,
    )
    .join("");
}

function filterItems(items) {
  if (activeBillFilter === "all") return items;
  return items.filter((item) => item.kind === activeBillFilter);
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
        : "Nenhuma conta neste mês ainda. Adicione uma conta, assinatura, caixa ou crédito.";
    dom.monthItems.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  dom.monthItems.innerHTML = items
    .map((item) => {
      const statusClass = item.overdue ? "overdue" : item.paid ? "paid" : "";
      const status = item.overdue ? "Atrasada" : item.paid ? "Paga" : "Pendente";
      const templateValueInput =
        item.kind === "template" && item.manual
          ? `<input type="number" min="0" step="0.01" value="${item.value || ""}" data-action="set-template-value" data-id="${item.id}" aria-label="Valor da caixa ${item.title}" />`
          : "";

      return `
        <div class="money-item ${statusClass}">
          <div>
            <p class="item-title">${item.title}</p>
            <p class="item-meta">${item.meta} • vence dia ${item.dueDay} • ${status}</p>
            ${templateValueInput}
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <div>
            <button class="small-action" data-action="toggle-paid" data-kind="${item.kind}" data-id="${item.id}" data-credit-id="${item.creditId || ""}" data-index="${item.installmentIndex ?? ""}" data-source-kind="${item.sourceKind || ""}" data-source-year="${item.sourceYear ?? ""}" data-source-month="${item.sourceMonth ?? ""}" data-source-id="${item.sourceId || ""}">
              ${item.paid ? "Desmarcar" : "Pagar"}
            </button>
            ${item.kind === "bill" && !item.sourceKind ? `<button class="small-action delete" data-action="delete-bill" data-id="${item.id}">Excluir</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderSubscriptions() {
  if (!state.subscriptions.length) {
    dom.subscriptionList.innerHTML = `<div class="empty-state">Nenhuma assinatura cadastrada. Quando adicionar, ela entra em todos os meses automaticamente.</div>`;
    return;
  }

  dom.subscriptionList.innerHTML = state.subscriptions
    .map(
      (item) => `
        <div class="money-item">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">Assinatura ${item.frequency === "annual" ? "anual" : "mensal"} • vence dia ${item.dueDay}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <button class="small-action delete" data-action="delete-subscription" data-id="${item.id}">Excluir</button>
        </div>
      `,
    )
    .join("");
}

function renderCharges() {
  if (!state.charges.length) {
    dom.chargeList.innerHTML = `<div class="empty-state">Nenhuma cobrança cadastrada. Use para pessoas que dividem assinatura ou conta com você.</div>`;
    return;
  }

  dom.chargeList.innerHTML = state.charges
    .map(
      (item) => `
        <div class="money-item">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">${item.description} • cobrança ${item.frequency === "annual" ? "anual" : "mensal"} • dia ${item.dueDay}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <button class="small-action delete" data-action="delete-charge" data-id="${item.id}">Excluir</button>
        </div>
      `,
    )
    .join("");
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
    dom.templateList.innerHTML = `<div class="empty-state">Nenhuma caixa criada. Crie uma para água, energia, mercado ou qualquer conta variável.</div>`;
    return;
  }

  dom.templateList.innerHTML = state.templates
    .map(
      (item) => `
        <div class="money-item">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">${item.manual ? "Valor manual por mês" : "Valor padrão todo mês"} • vence dia ${item.dueDay}</p>
          </div>
          <strong class="item-value">${item.manual ? "Manual" : money(item.value)}</strong>
          <button class="small-action delete" data-action="delete-template" data-id="${item.id}">Excluir</button>
        </div>
      `,
    )
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

function renderAnnual() {
  const annual = calculateAnnual();
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

  dom.annualTitle.textContent = `Resultado anual de ${selectedYear}`;
  dom.annualSubtitle.textContent =
    selectedYear > today.getFullYear() && monthLimit === 0
      ? "Nenhum mês desse ano foi preenchido ainda."
      : selectedYear > today.getFullYear()
        ? "Mostrando apenas meses futuros que já possuem dados."
        : selectedYear === today.getFullYear()
          ? `Acumulado de Janeiro até ${monthNames[monthLimit - 1]}.`
          : "Acumulado de Janeiro até Dezembro.";

  dom.annualSummary.innerHTML = [
    ["Renda do ano", money(annual.totals.income)],
    ["Total gasto", money(annual.totals.totalToPay)],
    ["Créditos", money(annual.categories.credit.total)],
    ["Sobra anual", money(annual.totals.leftover)],
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
    .map(
      (entry) => `
        <div class="annual-month-row">
          <strong>${monthNames[entry.month]}</strong>
          <span>Total: ${money(entry.summary.totalToPay)}</span>
          <span>Crédito: ${money(entry.summary.categories.credit.total)}</span>
          <span>Sobra: ${money(entry.summary.leftover)}</span>
        </div>
      `,
    )
    .join("") || `<div class="empty-state">Quando você preencher algum mês deste ano, ele aparece aqui.</div>`;
}

function renderSettings() {
  dom.settingsSalary.value = state.settings.baseSalary || "";
}

function cacheDom() {
  dom = {
    views: document.querySelectorAll(".view"),
    navPills: document.querySelectorAll(".nav-pill"),
    filterPills: document.querySelectorAll(".filter-pill"),
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
    monthLeftover: document.getElementById("month-leftover"),
    summaryStrip: document.getElementById("summary-strip"),
    miniLedger: document.getElementById("mini-ledger"),
    monthItems: document.getElementById("month-items"),
    monthlyCategoryBreakdown: document.getElementById("monthly-category-breakdown"),
    extrasList: document.getElementById("extras-list"),
    subscriptionList: document.getElementById("subscription-list"),
    chargeList: document.getElementById("charge-list"),
    creditList: document.getElementById("credit-list"),
    templateList: document.getElementById("template-list"),
    annualTitle: document.getElementById("annual-title"),
    annualSubtitle: document.getElementById("annual-subtitle"),
    annualSummary: document.getElementById("annual-summary"),
    annualPie: document.getElementById("annual-pie"),
    annualLegend: document.getElementById("annual-legend"),
    annualBars: document.getElementById("annual-bars"),
    annualMonthList: document.getElementById("annual-month-list"),
    settingsSalary: document.getElementById("settings-salary"),
  };
}

function togglePaid(kind, id, creditId, installmentIndex, source = {}) {
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
    setCreditInstallmentPaid(creditId, index, nextValue);
    return;
  }

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
  dom.navPills.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  dom.filterPills.forEach((button) => {
    button.addEventListener("click", () => {
      activeBillFilter = button.dataset.filter;
      dom.filterPills.forEach((item) => item.classList.toggle("active", item === button));
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
      render();
    }

    if (action === "next-year") {
      selectedYear += 1;
      render();
    }

    if (action === "select-month") {
      selectedMonth = Number(button.dataset.month);
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
      startYear: selectedYear,
      startMonth: selectedMonth,
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
      startYear: selectedYear,
      startMonth: selectedMonth,
    });
    event.target.reset();
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
