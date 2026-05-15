export const STORAGE_KEY = "sf-financeiro-v1";

export const monthNames = [
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

export const monthShort = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
export const weekdayShort = ["D", "S", "T", "Q", "Q", "S", "S"];
export const categoryConfig = {
  subscription: { label: "Assinaturas", color: "#1bb9d6" },
  credit: { label: "Crédito", color: "#4178ff" },
  template: { label: "Contas fixas", color: "#67e6b7" },
  bill: { label: "Contas do mês", color: "#ff9f43" },
  charge: { label: "A receber", color: "#9b5cff" },
};
export const today = new Date();

export const app = {
  selectedYear: today.getFullYear(),
  selectedMonth: today.getMonth(),
  activeView: "dashboard",
  activeBillFilter: "all",
  activeReceivableFilter: "all",
  showAllPayables: false,
  showAllReceivables: false,
  state: null,
  dom: {},
  calendarItemsByDay: {},
  recurringEditState: null,
  pendingDetailState: null,
};
