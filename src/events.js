import { app } from "./context.js";
import {
  createDefaultState,
  saveState,
  normalizeImportedState,
  exportBackup,
  numberValue,
  clampDay,
  uid,
  getMonthData,
  upsertRecurringRevision,
} from "./logic.js";
import {
  setView,
  render,
  renderDashboard,
  toggleMonthField,
  configureEditFrequencyOptions,
  openRecurringEdit,
  openPendingDetail,
  resolvePendingItems,
  closePendingDetail,
  refreshPendingDetail,
  showCalendarPopover,
  hideCalendarPopover,
  togglePaid,
  applyPaidToggle,
  populateMonthSelect,
} from "./ui.js";
function bindEvents() {
  populateMonthSelect(app.dom.subscriptionMonth);
  populateMonthSelect(app.dom.chargeMonth);
  populateMonthSelect(app.dom.editMonth);
  app.dom.subscriptionMonth.value = String(app.selectedMonth);
  app.dom.chargeMonth.value = String(app.selectedMonth);
  toggleMonthField(app.dom.subscriptionFrequency, app.dom.subscriptionMonthWrap, app.dom.subscriptionMonth);
  toggleMonthField(app.dom.chargeFrequency, app.dom.chargeMonthWrap, app.dom.chargeMonth, true);
  configureEditFrequencyOptions("subscription");

  app.dom.navPills.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.viewTarget));
  });

  app.dom.filterPills.forEach((button) => {
    button.addEventListener("click", () => {
      app.activeBillFilter = button.dataset.filter;
      app.showAllPayables = false;
      app.showAllReceivables = false;
      app.dom.filterPills.forEach((item) => item.classList.toggle("active", item === button));
      renderDashboard();
    });
  });

  app.dom.receivableFilterPills.forEach((button) => {
    button.addEventListener("click", () => {
      app.activeReceivableFilter = button.dataset.receivableFilter;
      app.showAllReceivables = false;
      app.dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item === button));
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
      app.selectedYear -= 1;
      app.showAllPayables = false;
      app.showAllReceivables = false;
      app.activeReceivableFilter = "all";
      app.dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
      render();
    }

    if (action === "next-year") {
      app.selectedYear += 1;
      app.showAllPayables = false;
      app.showAllReceivables = false;
      app.activeReceivableFilter = "all";
      app.dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
      render();
    }

    if (action === "select-month") {
      app.selectedMonth = Number(button.dataset.month);
      app.showAllPayables = false;
      app.showAllReceivables = false;
      app.activeReceivableFilter = "all";
      app.dom.receivableFilterPills.forEach((item) => item.classList.toggle("active", item.dataset.receivableFilter === "all"));
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

    if (action === "resolve-overdue-group" && app.pendingDetailState) {
      resolvePendingItems(app.pendingDetailState.items, true);
    }

    if (action === "resolve-all-group" && app.pendingDetailState) {
      resolvePendingItems(app.pendingDetailState.items);
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
      app.state.subscriptions = app.state.subscriptions.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-charge") {
      app.state.charges = app.state.charges.filter((item) => item.id !== button.dataset.id);
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
      app.state.credits = app.state.credits.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "delete-template") {
      app.state.templates = app.state.templates.filter((item) => item.id !== button.dataset.id);
      saveState();
      render();
    }

    if (action === "reset-data") {
      const confirmed = window.confirm("Tem certeza que deseja apagar todos os dados salvos?");
      if (!confirmed) return;
      app.state = createDefaultState();
      saveState();
      render();
    }

    if (action === "use-default-salary") {
      const monthData = getMonthData();
      monthData.baseSalary = numberValue(app.state.settings.baseSalary);
      saveState();
      render();
    }

    if (action === "export-backup") {
      exportBackup();
    }

    if (action === "import-backup") {
      app.dom.backupFileInput.click();
    }
  });

  app.dom.calendarGrid.addEventListener("mouseover", (event) => {
    const calendarDay = event.target.closest("[data-calendar-day]");
    if (!calendarDay) return;
    showCalendarPopover(calendarDay.dataset.calendarDay, calendarDay);
  });

  app.dom.calendarGrid.addEventListener("mouseleave", () => {
    window.setTimeout(() => {
      if (!app.dom.calendarPopover.matches(":hover")) hideCalendarPopover();
    }, 120);
  });

  app.dom.calendarPopover.addEventListener("mouseleave", hideCalendarPopover);

  app.dom.subscriptionFrequency.addEventListener("change", () => {
    toggleMonthField(app.dom.subscriptionFrequency, app.dom.subscriptionMonthWrap, app.dom.subscriptionMonth);
  });

  app.dom.chargeFrequency.addEventListener("change", () => {
    toggleMonthField(app.dom.chargeFrequency, app.dom.chargeMonthWrap, app.dom.chargeMonth, true);
  });

  app.dom.editFrequency.addEventListener("change", () => {
    toggleMonthField(app.dom.editFrequency, app.dom.editMonthWrap, app.dom.editMonth, app.recurringEditState?.kind === "charge");
  });

  app.dom.editCancel.addEventListener("click", () => {
    app.dom.recurringEditDialog.close();
  });

  app.dom.pendingDetailClose.addEventListener("click", () => {
    closePendingDetail();
  });

  app.dom.pendingDetailDialog.addEventListener("close", () => {
    app.pendingDetailState = null;
  });

  app.dom.monthItemsToggle.addEventListener("click", () => {
    app.showAllPayables = !app.showAllPayables;
    renderDashboard();
  });

  app.dom.receivableItemsToggle.addEventListener("click", () => {
    app.showAllReceivables = !app.showAllReceivables;
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
    monthData.baseSalary = numberValue(app.dom.baseSalary.value);
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
    app.dom.subscriptionFrequency.value = "monthly";
    app.dom.subscriptionMonth.value = String(app.selectedMonth);
    toggleMonthField(app.dom.subscriptionFrequency, app.dom.subscriptionMonthWrap, app.dom.subscriptionMonth);
    saveState();
    render();
  });

  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    app.state.settings.baseSalary = numberValue(app.dom.settingsSalary.value);
    saveState();
    setView("dashboard");
  });

  app.dom.backupFileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      app.state = normalizeImportedState(parsed);
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
    app.state.subscriptions.push({
      id: uid("subscription"),
      name: document.getElementById("subscription-name").value.trim(),
      value: numberValue(document.getElementById("subscription-value").value),
      dueDay: clampDay(document.getElementById("subscription-day").value),
      frequency: document.getElementById("subscription-frequency").value,
      dueMonth:
        document.getElementById("subscription-frequency").value === "annual"
          ? Number(document.getElementById("subscription-month").value)
          : null,
      startYear: app.selectedYear,
      startMonth: app.selectedMonth,
      revisions: [],
    });
    event.target.reset();
    saveState();
    render();
  });

  document.getElementById("charge-form").addEventListener("submit", (event) => {
    event.preventDefault();
    app.state.charges.push({
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
      startYear: app.selectedYear,
      startMonth:
        document.getElementById("charge-frequency").value === "once"
          ? Number(document.getElementById("charge-month").value)
          : app.selectedMonth,
      revisions: [],
    });
    event.target.reset();
    app.dom.chargeFrequency.value = "monthly";
    app.dom.chargeMonth.value = String(app.selectedMonth);
    toggleMonthField(app.dom.chargeFrequency, app.dom.chargeMonthWrap, app.dom.chargeMonth, true);
    saveState();
    render();
  });

  app.dom.recurringEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!app.recurringEditState) return;

    const collection = app.recurringEditState.kind === "subscription" ? app.state.subscriptions : app.state.charges;
    const item = collection.find((entry) => entry.id === app.recurringEditState.id);
    if (!item) return;

    upsertRecurringRevision(
      item,
      {
        name: app.dom.editName.value.trim(),
        description: app.recurringEditState.kind === "charge" ? app.dom.editDescription.value.trim() : undefined,
        value: app.dom.editValue.value,
        dueDay: app.dom.editDay.value,
        dueMonth: app.dom.editMonth.value,
        frequency: app.dom.editFrequency.value,
      },
      app.selectedYear,
      app.selectedMonth,
    );

    app.dom.recurringEditDialog.close();
    app.recurringEditState = null;
    saveState();
    render();
  });

  document.getElementById("credit-form").addEventListener("submit", (event) => {
    event.preventDefault();
    app.state.credits.push({
      id: uid("credit"),
      name: document.getElementById("credit-name").value.trim(),
      value: numberValue(document.getElementById("credit-value").value),
      installments: Math.max(1, Math.round(numberValue(document.getElementById("credit-installments").value))),
      dueDay: clampDay(document.getElementById("credit-day").value),
      startYear: app.selectedYear,
      startMonth: app.selectedMonth,
      paid: [],
    });
    event.target.reset();
    saveState();
    render();
  });

  document.getElementById("template-form").addEventListener("submit", (event) => {
    event.preventDefault();
    app.state.templates.push({
      id: uid("template"),
      name: document.getElementById("template-name").value.trim(),
      value: numberValue(document.getElementById("template-value").value),
      dueDay: clampDay(document.getElementById("template-day").value),
      manual: document.getElementById("template-manual").checked,
      startYear: app.selectedYear,
      startMonth: app.selectedMonth,
    });
    event.target.reset();
    saveState();
    render();
  });
}
export { bindEvents };
