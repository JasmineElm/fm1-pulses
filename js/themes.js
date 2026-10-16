// themes.js — FM-1 display themes management.
import { renderScope } from "./scope.js?v=100";

export const THEMES = [
  { id: "dark", name: "Dark", icon: "🌙", accent: "#3b82f6" },
  { id: "light", name: "Light", icon: "☀️", accent: "#2563eb" },
];

export function applyTheme(id) {
  const themeId = id === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = themeId;
  localStorage.setItem("fm1p.theme", themeId);
  document.querySelectorAll(".theme-btn, .swatch").forEach((s) => {
    const isActive = s.dataset.id === themeId;
    s.classList.toggle("active", isActive);
    s.setAttribute("aria-pressed", String(isActive));
  });
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  renderScope();
}

export function buildTheme() {
  const menus = document.querySelectorAll(".swatches, #themes");
  if (!menus.length) return;
  for (const menu of menus) {
    menu.innerHTML = "";
    for (const t of THEMES) {
      const b = document.createElement("button");
      b.className = "theme-btn";
      b.dataset.id = t.id;
      b.textContent = `${t.icon} ${t.name}`;
      b.title = `Switch to ${t.name} theme`;
      b.setAttribute("aria-label", `${t.name} theme`);
      b.addEventListener("click", () => applyTheme(t.id));
      menu.appendChild(b);
    }
  }
  const saved = localStorage.getItem("fm1p.theme");
  applyTheme(saved === "light" ? "light" : "dark");
}
