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
const today = new Date();

let selectedYear = today.getFullYear();
let selectedMonth = today.getMonth();
let activeView = "dashboard";
let activeBillFilter = "all";
let state = loadState();
let dom = {};

function createDefaultState() {
  return {
    settings: {
      baseSalary: 0,
    },
    years: {},
    subscriptions: [],
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
      extraIncome: 0,
      extras: [],
      bills: [],
      subscriptionPaid: {},
      templateValues: {},
      creditPaid: {},
    };
  }
  return yearData.months[key];
}

function getMonthData() {
  return ensureMonth(selectedYear, selectedMonth);
}

function monthsBetween(startYear, startMonth, year, month) {
  return (year - startYear) * 12 + (month - startMonth);
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
  const monthData = getMonthData();
  const items = [];

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

  state.subscriptions.forEach((subscription) => {
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

  state.credits.forEach((credit) => {
    getCreditInstallmentsForMonth(credit, selectedYear, selectedMonth).forEach((installment) => {
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

function calculateMonth() {
  const monthData = getMonthData();
  const items = getCurrentItems();
  const baseSalary = numberValue(state.settings.baseSalary);
  monthData.extras = Array.isArray(monthData.extras) ? monthData.extras : [];
  const extraIncome =
    numberValue(monthData.extraIncome) + monthData.extras.reduce((sum, item) => sum + numberValue(item.value), 0);
  const income = baseSalary + extraIncome;
  const totalToPay = items.reduce((sum, item) => sum + numberValue(item.value), 0);
  const paid = items.filter((item) => item.paid).reduce((sum, item) => sum + numberValue(item.value), 0);
  const pending = totalToPay - paid;
  const leftover = income - pending;

  return {
    baseSalary,
    extraIncome,
    income,
    items,
    totalToPay,
    paid,
    pending,
    leftover,
  };
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
  renderCredits();
  renderTemplates();
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
  const itemsByDay = getCurrentItems().reduce((days, item) => {
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
    const dayItems = itemsByDay[day] || [];
    const billClass = dayItems.length ? " has-bills" : "";
    const overdueClass = dayItems.some((item) => item.overdue) ? " has-overdue" : "";
    const title = dayItems.length
      ? ` title="${dayItems.map((item) => `${item.title}: ${money(item.value)}`).join(" | ")}"`
      : "";
    const badge = dayItems.length ? `<span class="calendar-badge">${dayItems.length}</span>` : "";
    dom.calendarGrid.insertAdjacentHTML(
      "beforeend",
      `<div class="calendar-day${todayClass}${billClass}${overdueClass}"${title}>${day}${badge}</div>`,
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

  dom.baseSalary.value = state.settings.baseSalary || "";
  dom.incomeStatus.textContent = money(summary.income);
  dom.billCount.textContent =
    activeBillFilter === "all"
      ? `${summary.items.length} itens`
      : `${filteredItems.length} de ${summary.items.length} itens`;
  dom.monthLeftover.textContent = money(summary.leftover);

  dom.summaryStrip.innerHTML = [
    ["Salário + extras", money(summary.income)],
    ["Total para pagar", money(summary.totalToPay)],
    ["Pendente", money(summary.pending)],
    ["Sobra prevista", money(summary.leftover)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  dom.miniLedger.innerHTML = [
    ["Salário base", money(summary.baseSalary)],
    ["Extras", money(summary.extraIncome)],
    ["Pago/marcado", money(summary.paid)],
    ["Ainda falta", money(summary.pending)],
  ]
    .map(([label, value]) => `<div class="ledger-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  renderMonthItems(filteredItems, summary.items.length);
  renderExtras();
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
            <button class="small-action" data-action="toggle-paid" data-kind="${item.kind}" data-id="${item.id}" data-credit-id="${item.creditId || ""}" data-index="${item.installmentIndex ?? ""}">
              ${item.paid ? "Desmarcar" : "Pagar"}
            </button>
            ${item.kind === "bill" ? `<button class="small-action delete" data-action="delete-bill" data-id="${item.id}">Excluir</button>` : ""}
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
            <p class="item-meta">Assinatura mensal • vence dia ${item.dueDay}</p>
          </div>
          <strong class="item-value">${money(item.value)}</strong>
          <button class="small-action delete" data-action="delete-subscription" data-id="${item.id}">Excluir</button>
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
    extrasList: document.getElementById("extras-list"),
    subscriptionList: document.getElementById("subscription-list"),
    creditList: document.getElementById("credit-list"),
    templateList: document.getElementById("template-list"),
    settingsSalary: document.getElementById("settings-salary"),
  };
}

function togglePaid(kind, id, creditId, installmentIndex) {
  const monthData = getMonthData();

  if (kind === "bill") {
    const bill = monthData.bills.find((item) => item.id === id);
    if (bill) bill.paid = !bill.paid;
  }

  if (kind === "subscription") {
    monthData.subscriptionPaid[id] = !monthData.subscriptionPaid[id];
  }

  if (kind === "template") {
    const saved = monthData.templateValues[id] || {};
    saved.paid = !saved.paid;
    monthData.templateValues[id] = saved;
  }

  if (kind === "credit") {
    const index = Number(installmentIndex);
    const credit = state.credits.find((item) => item.id === creditId);
    const nextValue = credit ? !isCreditInstallmentPaid(credit, index) : false;
    setCreditInstallmentPaid(creditId, index, nextValue);
    return;
  }

  saveState();
  render();
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
      togglePaid(button.dataset.kind, button.dataset.id, button.dataset.creditId, button.dataset.index);
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
    state.settings.baseSalary = numberValue(dom.baseSalary.value);
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
