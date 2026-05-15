import { app } from "./context.js";
import { loadState } from "./logic.js";
import { cacheDom, render, setView } from "./ui.js";
import { bindEvents } from "./events.js";

app.state = loadState();
cacheDom();
bindEvents();
render();
setView(app.activeView, { render: false });
