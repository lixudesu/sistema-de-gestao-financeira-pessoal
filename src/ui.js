import { app, monthNames, monthShort, weekdayShort, today } from "./context.js";
import {
  money,
  numberValue,
  ensureMonth,
  getMonthData,
  calculateMonth,
  calculateOverdueExpenses,
  escapeHtml,
  buildDisplayItems,
  getPaidOneTimeReceivableHistory,
  sortMonthItems,
  getItemBaseKey,
  getRecurringSnapshot,
  getTemplateSnapshot,
  getAllPaidOneTimeCharges,
  calculateAnnual,
  calculateAnnualOverview,
  getCurrentItems,
  isCreditInstallmentPaid,
  setCreditInstallmentPaid,
  saveState,
} from "./logic.js";
function setView(view, options = {}) {
  app.activeView = view;
  if (view !== "dashboard") {
    app.showAllPayables = false;
    app.showAllReceivables = false;
  }
  app.dom.views.forEach((item) => {
    item.classList.toggle("active", item.id === `${view}-view`);
  });
  app.dom.navPills.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === view);
  });
  if (options.render !== false) {
    renderActiveView();
  }
}

function render() {
  ensureMonth(app.selectedYear, app.selectedMonth);
  renderHeader();
  renderActiveView();
}

function renderActiveView() {
  if (app.activeView === "dashboard") {
    const summary = calculateMonth();
    renderCalendar(summary.items);
    renderMonthTabs();
    renderDashboard(summary);
    return;
  }

  if (app.activeView === "subscriptions") renderSubscriptions();
  if (app.activeView === "charges") renderCharges();
  if (app.activeView === "credits") renderCredits();
  if (app.activeView === "templates") renderTemplates();
  if (app.activeView === "annual") renderAnnual();
  if (app.activeView === "settings") renderSettings();
}

function renderHeader() {
  app.dom.selectedMonthTitle.textContent = `${monthNames[app.selectedMonth]} ${app.selectedYear}`;
  app.dom.selectedYear.textContent = app.selectedYear;
  app.dom.selectedYearCopy.textContent = `Você está vendo ${app.selectedYear}. Os dados deste ano ficam separados dos outros anos.`;
}

function renderCalendar(items = getCurrentItems()) {
  const firstDay = new Date(app.selectedYear, app.selectedMonth, 1).getDay();
  const daysInMonth = new Date(app.selectedYear, app.selectedMonth + 1, 0).getDate();
  const isCurrentMonth = today.getFullYear() === app.selectedYear && today.getMonth() === app.selectedMonth;
  app.calendarItemsByDay = items.reduce((days, item) => {
    const day = Math.max(1, Math.min(daysInMonth, item.dueDay));
    days[day] = days[day] || [];
    days[day].push(item);
    return days;
  }, {});

  app.dom.calendarTitle.textContent = `${monthNames[app.selectedMonth]} ${app.selectedYear}`;
  app.dom.todayChip.textContent = isCurrentMonth ? `Hoje, dia ${today.getDate()}` : "Mês salvo";
  app.dom.calendarGrid.innerHTML = "";

  weekdayShort.forEach((day) => {
    app.dom.calendarGrid.insertAdjacentHTML("beforeend", `<div class="calendar-weekday">${day}</div>`);
  });

  for (let blank = 0; blank < firstDay; blank += 1) {
    app.dom.calendarGrid.insertAdjacentHTML("beforeend", "<div></div>");
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const todayClass = isCurrentMonth && today.getDate() === day ? " today" : "";
    const dayItems = app.calendarItemsByDay[day] || [];
    const billClass = dayItems.length ? " has-bills" : "";
    const overdueClass = dayItems.some((item) => item.overdue) ? " has-overdue" : "";
    const badge = dayItems.length ? `<span class="calendar-badge">${dayItems.length}</span>` : "";
    app.dom.calendarGrid.insertAdjacentHTML(
      "beforeend",
      `<button class="calendar-day${todayClass}${billClass}${overdueClass}" data-calendar-day="${day}" type="button">${day}${badge}</button>`,
    );
  }
}

function renderMonthTabs() {
  app.dom.monthTabs.innerHTML = monthShort
    .map((month, index) => {
      const active = index === app.selectedMonth ? " active" : "";
      return `<button class="month-tab${active}" data-action="select-month" data-month="${index}">${month}</button>`;
    })
    .join("");
}

function renderDashboard(summary = calculateMonth()) {
  const monthData = getMonthData();
  const payableItems = summary.items.filter((item) => item.kind !== "charge");
  const monthReceivableItems = summary.items.filter((item) => item.kind === "charge");
  const oneTimeReceivableHistory = getPaidOneTimeReceivableHistory(app.selectedYear, app.selectedMonth, monthReceivableItems);
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
      meta: `Extra já registrado em ${monthNames[app.selectedMonth]} ${app.selectedYear}`,
    })) || []),
  ];
  const filteredItems = buildDisplayItems(filterItems(payableItems));
  const filteredReceivables =
    app.activeReceivableFilter === "once"
      ? buildDisplayItems(sortMonthItems([...monthReceivableItems.filter((item) => item.recurringFrequency === "once"), ...oneTimeReceivableHistory]))
      : buildDisplayItems(sortMonthItems(receivableItems));
  const limitedPayables = app.showAllPayables ? filteredItems : filteredItems.slice(0, 5);
  const limitedReceivables = app.showAllReceivables ? filteredReceivables : filteredReceivables.slice(0, 5);
  const overdueExpenseTotal = calculateOverdueExpenses(summary.items);
  const monthStatusText =
    summary.leftover > 0
      ? `Sobrou ${money(summary.leftover)} neste mês, considerando o que já entrou e o que ainda falta pagar.`
      : summary.leftover < 0
        ? `Este mês está negativo em ${money(Math.abs(summary.leftover))}. Ainda falta cobertura para fechar as contas.`
        : "Este mês está zerado: o que entrou ficou exatamente empatado com o que falta pagar.";

  app.dom.baseSalary.value =
    monthData.baseSalary === null || monthData.baseSalary === undefined
      ? app.state.settings.baseSalary || ""
      : monthData.baseSalary || "";
  app.dom.incomeStatus.textContent = money(summary.income);
  app.dom.billCount.hidden = true;
  app.dom.receivableCount.hidden = true;
  app.dom.monthLeftover.textContent = money(summary.leftover);
  app.dom.monthResultDescription.textContent = monthStatusText;

  app.dom.summaryStrip.innerHTML = [
    ["Receita", money(summary.income)],
    ["Total para pagar", money(summary.totalToPay)],
    ["Pendente", money(summary.pending)],
    ["Sobrou", money(summary.leftover)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  app.dom.miniLedger.innerHTML = [
    ["Total de atrasados", money(overdueExpenseTotal)],
    ["A receber deste mês", money(summary.chargesReceivableCurrent)],
    ["A receber atrasado", money(summary.chargesReceivableOverdue)],
    ["A receber recebido", money(summary.chargesReceived)],
    ["Extras", money(summary.extraIncome)],
    ["Receita do mês", money(summary.income)],
    ["Assinaturas pagas", money(summary.categories.subscription.paid)],
    ["Contas fixas pagas", money(summary.categories.template.paid)],
    ["Contas do mês pagas", money(summary.categories.bill.paid)],
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

  app.dom.monthlyCategoryBreakdown.innerHTML = cards.join("");
}

function filterItems(items) {
  if (app.activeBillFilter === "all") return items;
  return items.filter((item) => item.kind === app.activeBillFilter);
}

function filterReceivableItems(items) {
  if (app.activeReceivableFilter === "all") return items;
  if (app.activeReceivableFilter === "once") {
    return items.filter((item) => item.kind === "charge" && item.recurringFrequency === "once");
  }
  return items;
}

function renderExtras() {
  const monthData = getMonthData();
  monthData.extras = Array.isArray(monthData.extras) ? monthData.extras : [];

  if (!monthData.extras.length) {
    app.dom.extrasList.innerHTML = `<div class="empty-state">Nenhum extra neste mês ainda.</div>`;
    return;
  }

  app.dom.extrasList.innerHTML = monthData.extras
    .map(
      (item) => `
        <div class="money-item">
          <div>
            <p class="item-title">${escapeHtml(item.name)}</p>
            <p class="item-meta">Entrada extra em ${monthNames[app.selectedMonth]} ${app.selectedYear}</p>
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
        : "Nenhuma conta neste mês ainda. Adicione uma conta do mês, assinatura, conta fixa ou crédito.";
    app.dom.monthItems.innerHTML = `<div class="empty-state">${message}</div>`;
    app.dom.monthItemsToggle.hidden = true;
    return;
  }

  app.dom.monthItems.innerHTML = items
    .map((item) => {
      const statusClass = item.overdue ? "overdue" : item.paid ? "paid" : "";
      const status = item.overdue ? "Atrasada" : item.paid ? "Paga" : "Pendente";
      const itemTitle = escapeHtml(item.title);
      const itemMeta = escapeHtml(item.meta);
      const titleMarkup = item.group
        ? `<button class="item-link ${item.overdue ? "is-overdue" : ""}" type="button" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">${itemTitle}</button>`
        : `<p class="item-title ${item.overdue ? "is-overdue" : ""}">${itemTitle}</p>`;
      const templateValueInput =
        item.kind === "template" && item.manual
          ? `<input type="number" min="0" step="0.01" value="${item.value || ""}" data-action="set-template-value" data-id="${item.id}" aria-label="Valor da conta fixa ${itemTitle}" />`
          : "";

      return `
        <div class="money-item ${statusClass}">
          <div>
            ${titleMarkup}
            <p class="item-meta">${itemMeta} • vence dia ${item.dueDay} • ${status}</p>
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
  app.dom.monthItemsToggle.hidden = !hasOverflow;
  app.dom.monthItemsToggle.textContent = app.showAllPayables ? "▲ Mostrar menos" : "▼ Ver mais";
}

function renderSubscriptions() {
  if (!app.state.subscriptions.length) {
    app.dom.subscriptionList.innerHTML = `<div class="empty-state">Nenhuma assinatura cadastrada. Quando adicionar, ela entra em todos os meses automaticamente.</div>`;
    return;
  }

  app.dom.subscriptionList.innerHTML = app.state.subscriptions
    .map((item) => {
      const snapshot = getRecurringSnapshot(item, app.selectedYear, app.selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${escapeHtml(snapshot.name)}</p>
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
    app.dom.receivableItems.innerHTML = `<div class="empty-state">${message}</div>`;
    app.dom.receivableItemsToggle.hidden = true;
    return;
  }

  app.dom.receivableItems.innerHTML = items
    .map((item) => {
      const statusClass = item.overdue ? "overdue" : item.paid ? "paid" : "";
      const status = item.overdue ? "Atrasado" : item.paid ? "Recebido" : "Pendente";
      const itemTitle = escapeHtml(item.title);
      const itemMeta = escapeHtml(item.meta);
      const titleMarkup = item.group
        ? `<button class="item-link ${item.overdue ? "is-overdue" : ""}" type="button" data-action="open-pending-detail" data-group-key="${item.groupKey}" data-kind="${item.kind}">${itemTitle}</button>`
        : `<p class="item-title ${item.overdue ? "is-overdue" : ""}">${itemTitle}</p>`;

      return `
        <div class="money-item ${statusClass}">
          <div>
            ${titleMarkup}
            <p class="item-meta">${itemMeta}${item.staticEntry ? "" : ` • dia ${item.dueDay}`} • ${status}</p>
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
  app.dom.receivableItemsToggle.hidden = !hasOverflow;
  app.dom.receivableItemsToggle.textContent = app.showAllReceivables ? "▲ Mostrar menos" : "▼ Ver mais";
}

function renderCharges() {
  if (!app.state.charges.length) {
    app.dom.chargeList.innerHTML = `<div class="empty-state">Nenhum item a receber cadastrado. Use para pessoas que dividem assinatura ou conta com você.</div>`;
    app.dom.chargePaidList.innerHTML = `<div class="empty-state">Nenhum pagamento único recebido ainda.</div>`;
    return;
  }

  app.dom.chargeList.innerHTML = app.state.charges
    .map((item) => {
      const snapshot = getRecurringSnapshot(item, app.selectedYear, app.selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${escapeHtml(snapshot.name)}</p>
            <p class="item-meta">${escapeHtml(snapshot.description)} • a receber ${snapshot.frequency === "annual" ? `anual • ${monthNames[snapshot.dueMonth]}` : snapshot.frequency === "once" ? `Pagamento Único • ${monthNames[snapshot.dueMonth ?? app.selectedMonth]}` : "mensal"} • dia ${snapshot.dueDay}</p>
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
    app.dom.chargePaidList.innerHTML = `<div class="empty-state">Nenhum pagamento único recebido ainda.</div>`;
    return;
  }

  app.dom.chargePaidList.innerHTML = paidOneTimeCharges
    .map(
      (item) => `
        <div class="money-item paid">
          <div>
            <p class="item-title">${escapeHtml(item.title)}</p>
            <p class="item-meta">${escapeHtml(item.meta)} • dia ${item.dueDay}</p>
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

  app.pendingDetailState = { groupKey, kind, items: sortMonthItems(groupedItems) };
  const overdueItems = app.pendingDetailState.items.filter((item) => item.overdue);
  const label = kind === "charge" ? "receber" : "pagar";

  app.dom.pendingDetailTitle.textContent = app.pendingDetailState.items[0].title;
  app.dom.pendingDetailCopy.textContent =
    overdueItems.length > 0
      ? `Existem ${overdueItems.length} pendência(s) atrasada(s). Você pode ${label} uma por vez ou resolver tudo.`
      : `Você pode ${label} cada pendência separadamente.`;

  app.dom.pendingDetailActions.innerHTML = `
    ${overdueItems.length ? `<button class="small-action" type="button" data-action="resolve-overdue-group">${kind === "charge" ? "Receber atrasadas" : "Pagar atrasadas"}</button>` : ""}
    <button class="primary-button" type="button" data-action="resolve-all-group">${kind === "charge" ? "Receber tudo" : "Pagar tudo"}</button>
  `;

  app.dom.pendingDetailList.innerHTML = app.pendingDetailState.items
    .map(
      (item) => `
        <div class="money-item ${item.overdue ? "overdue" : ""}">
          <div>
            <p class="item-title ${item.overdue ? "is-overdue" : ""}">${escapeHtml(item.title)}</p>
            <p class="item-meta">${escapeHtml(item.meta)} • vence dia ${item.dueDay} • ${item.overdue ? "Atrasado" : "Pendente"}</p>
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

  if (!app.dom.pendingDetailDialog.open) {
    app.dom.pendingDetailDialog.showModal();
  }
}

function closePendingDetail() {
  app.pendingDetailState = null;
  if (app.dom.pendingDetailDialog?.open) {
    app.dom.pendingDetailDialog.close();
  }
}

function refreshPendingDetail() {
  if (!app.pendingDetailState) return;
  const { groupKey, kind } = app.pendingDetailState;
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
  if (!app.state.credits.length) {
    app.dom.creditList.innerHTML = `<div class="empty-state">Nenhum crédito cadastrado. Use para empréstimos, parcelas e compras longas.</div>`;
    return;
  }

  app.dom.creditList.innerHTML = app.state.credits
    .map((credit) => {
      const paidCount = Array.isArray(credit.paid) ? credit.paid.length : 0;
      const remaining = Math.max(0, credit.installments - paidCount);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${escapeHtml(credit.name)}</p>
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
  if (!app.state.templates.length) {
    app.dom.templateList.innerHTML = `<div class="empty-state">Nenhuma conta fixa criada. Cadastre internet, plano de saúde ou qualquer despesa recorrente previsível.</div>`;
    return;
  }

  app.dom.templateList.innerHTML = app.state.templates
    .map((item) => {
      const snapshot = getTemplateSnapshot(item, app.selectedYear, app.selectedMonth);
      return `
        <div class="money-item">
          <div>
            <p class="item-title">${escapeHtml(snapshot.name)}</p>
            <p class="item-meta">${snapshot.manual ? "Preencher manualmente por mês" : "Valor padrão todo mês"} • vence dia ${snapshot.dueDay}</p>
          </div>
          <strong class="item-value">${snapshot.manual ? "Manual" : money(snapshot.value)}</strong>
          <button class="small-action delete" data-action="delete-template" data-id="${item.id}">Excluir</button>
        </div>
      `;
    })
    .join("");
}

function renderAnnual() {
  const annual = calculateAnnual();
  const annualOverview = calculateAnnualOverview(annual);
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

  app.dom.annualTitle.textContent = `Resultado anual`;
  app.dom.annualSubtitle.textContent =
    app.selectedYear > today.getFullYear() && monthLimit === 0
      ? `O ano selecionado é ${app.selectedYear}, mas ainda não há dados preenchidos para esse período.`
      : app.selectedYear > today.getFullYear()
        ? `Ano selecionado: ${app.selectedYear}. Receita, assinaturas e contas consideram esse ano; créditos mostram o total contratado no sistema.`
        : app.selectedYear === today.getFullYear()
          ? `Ano selecionado: ${app.selectedYear}. O resumo considera de Janeiro até ${monthNames[monthLimit - 1]} e os créditos continuam globais.`
          : `Ano selecionado: ${app.selectedYear}. O resumo considera Janeiro até Dezembro; créditos mostram o total contratado no sistema.`;

  app.dom.annualRevenueCopy.textContent = `Tudo o que entrou no ano selecionado até agora, incluindo salário, extras e valores recebidos.`;
  app.dom.annualRevenueSummary.innerHTML = [
    ["Receita total", money(annualOverview.revenueTotal)],
    ["Salário total recebido", money(annualOverview.salaryTotal)],
    ["Extra total recebido", money(annualOverview.extrasTotal)],
    ["A receber total recebido", money(annualOverview.chargesReceivedTotal)],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  app.dom.annualSubscriptionCopy.textContent = `Mostra o valor atual somado das assinaturas ativas no sistema e o quanto já foi pago delas no ano selecionado.`;
  app.dom.annualSubscriptionSummary.innerHTML = [
    ["Total de assinaturas", money(annualOverview.subscriptionTotalValue)],
    ["Assinaturas total pagas", money(annualOverview.subscriptionsPaidTotal)],
    ["Assinaturas total ativas", `${annualOverview.subscriptionActiveCount}`],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  app.dom.annualCreditCopy.textContent = `Créditos ignoram o ano selecionado e mostram o total contratado no sistema inteiro, mesmo que durem vários anos.`;
  app.dom.annualCreditSummary.innerHTML = [
    ["Crédito total contratado", money(annualOverview.creditBorrowed)],
    ["Crédito total já pago", money(annualOverview.creditPaid)],
    ["Crédito total a pagar", money(annualOverview.creditRemaining)],
    ["Créditos ativos", `${annualOverview.creditCount}`],
  ]
    .map(([label, value]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");

  app.dom.annualPie.style.background = categoryTotal
    ? `conic-gradient(${pieParts.join(", ")})`
    : "conic-gradient(rgba(255,255,255,0.6) 0% 100%)";

  app.dom.annualLegend.innerHTML = categoryEntries
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

  app.dom.annualBars.innerHTML = annual.months
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

  app.dom.annualMonthList.innerHTML = annual.months
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
  app.dom.settingsSalary.value = app.state.settings.baseSalary || "";
}

function populateMonthSelect(select) {
  select.innerHTML = monthNames.map((month, index) => `<option value="${index}">${month}</option>`).join("");
}

function toggleMonthField(select, wrap, monthSelect, allowOnce = false) {
  const shouldShow = select.value === "annual" || (allowOnce && select.value === "once");
  wrap.classList.toggle("is-hidden", !shouldShow);
  if (shouldShow && (monthSelect.value === "" || monthSelect.value === undefined)) {
    monthSelect.value = String(app.selectedMonth);
  }
}

function configureEditFrequencyOptions(kind) {
  const onceOption = app.dom.editFrequency.querySelector('option[value="once"]');
  if (!onceOption) return;
  onceOption.hidden = kind !== "charge";
  if (kind !== "charge" && app.dom.editFrequency.value === "once") {
    app.dom.editFrequency.value = "monthly";
  }
}

function openRecurringEdit(kind, id) {
  const collection = kind === "subscription" ? app.state.subscriptions : app.state.charges;
  const item = collection.find((entry) => entry.id === id);
  if (!item) return;

  const snapshot = getRecurringSnapshot(item, app.selectedYear, app.selectedMonth);
  app.recurringEditState = { kind, id };
  app.dom.editDialogTitle.textContent = kind === "subscription" ? "Editar assinatura" : "Editar item a receber";
  app.dom.editDescriptionWrap.classList.toggle("is-hidden", kind !== "charge");
  configureEditFrequencyOptions(kind);
  app.dom.editName.value = snapshot.name;
  app.dom.editDescription.value = snapshot.description || "";
  app.dom.editValue.value = snapshot.value;
  app.dom.editFrequency.value = snapshot.frequency || "monthly";
  app.dom.editMonth.value = String(snapshot.dueMonth ?? app.selectedMonth);
  app.dom.editDay.value = snapshot.dueDay;
  app.dom.editEffectiveMonth.textContent = `${monthNames[app.selectedMonth]} ${app.selectedYear}`;
  toggleMonthField(app.dom.editFrequency, app.dom.editMonthWrap, app.dom.editMonth, kind === "charge");
  app.dom.recurringEditDialog.showModal();
}

function cacheDom() {
  app.dom = {
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
    const credit = app.state.credits.find((item) => item.id === creditId);
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
  const items = app.calendarItemsByDay[day] || [];
  if (!items.length) {
    hideCalendarPopover();
    return;
  }

  app.dom.calendarPopover.innerHTML = `
    <strong>Dia ${day} • ${items.length} item${items.length > 1 ? "s" : ""}</strong>
    ${items
      .map(
        (item) => `
          <div class="calendar-popover-item">
            <span>${escapeHtml(item.title)}</span>
            <span>${money(item.value)}</span>
          </div>
        `,
      )
      .join("")}
  `;

  const cardRect = target.closest(".calendar-card").getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const left = Math.min(targetRect.left - cardRect.left, cardRect.width - 290);
  app.dom.calendarPopover.style.left = `${Math.max(12, left)}px`;
  app.dom.calendarPopover.style.top = `${targetRect.bottom - cardRect.top + 10}px`;
  app.dom.calendarPopover.hidden = false;
}

function hideCalendarPopover() {
  app.dom.calendarPopover.hidden = true;
}

export {
  setView,
  render,
  renderHeader,
  renderCalendar,
  renderMonthTabs,
  renderDashboard,
  renderMonthlyCategoryBreakdown,
  renderExtras,
  renderMonthItems,
  openPendingDetail,
  closePendingDetail,
  refreshPendingDetail,
  resolvePendingItems,
  renderCredits,
  renderTemplates,
  renderAnnual,
  renderSettings,
  populateMonthSelect,
  toggleMonthField,
  configureEditFrequencyOptions,
  openRecurringEdit,
  cacheDom,
  applyPaidToggle,
  togglePaid,
  showCalendarPopover,
  hideCalendarPopover,
};
