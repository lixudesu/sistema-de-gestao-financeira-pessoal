import { app } from "./context.js";
import { hydrateState } from "./logic.js";
import { cacheDom, render, setView } from "./ui.js";
import { bindEvents } from "./events.js";

async function init() {
  app.state = await hydrateState();
  cacheDom();
  bindEvents();
  render();
  setView(app.activeView, { render: false });
}

void init();
