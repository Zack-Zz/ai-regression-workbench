const NAV_ITEMS = [
  { key: "home", base: "index", zh: "首页", en: "Home" },
  { key: "runs", base: "run-list", zh: "运行列表", en: "Run List" },
  { key: "detail", base: "run-detail", zh: "运行详情", en: "Run Detail" },
  { key: "failure", base: "failure-report", zh: "失败报告", en: "Failure Report" },
  { key: "task", base: "code-task-detail", zh: "修复任务", en: "CodeTask" },
  { key: "review", base: "review-commit", zh: "评审提交", en: "Review/Commit" }
];

const MODULE_DESCRIPTIONS = {
  home: {
    zh: "工作台总览：工作区状态、快速启动、待处理任务和系统告警。",
    en: "Workbench overview: workspace status, quick run, pending tasks, and system notices."
  },
  runs: {
    zh: "运行列表：查看 run 范围、状态、统计和当前卡点，快速定位问题批次。",
    en: "Run list: check scope, status, metrics, and current bottlenecks to locate problematic runs."
  },
  detail: {
    zh: "运行详情：阶段结果、执行报告、事件时间线和关联修复任务。",
    en: "Run detail: stage results, execution report, event timeline, and related remediation tasks."
  },
  failure: {
    zh: "失败报告：接口明细、点击事件、流程步骤、trace/log 与 AI 归因。",
    en: "Failure report: API details, UI actions, flow steps, trace/log signals, and AI root cause."
  },
  task: {
    zh: "修复任务：目标目录、作用范围、diff/patch、verify 与审批执行状态。",
    en: "Code task: target workspace, scope, diff/patch, verify outputs, and approval/execution state."
  },
  review: {
    zh: "评审提交：review 与 commit 分离，人工确认后再显式提交。",
    en: "Review/commit: review and commit are separated, explicit commit after manual confirmation."
  }
};

function detectLangFromPath(pathname) {
  return pathname.endsWith(".en.html") ? "en" : "zh";
}

function resolvePageBase(pathname) {
  const file = pathname.split("/").pop() || "index.html";
  return file.replace(".en.html", "").replace(".html", "");
}

function pageHref(base, lang) {
  return `${base}${lang === "en" ? ".en" : ""}.html`;
}

function renderNav(activeKey, lang) {
  return NAV_ITEMS.map((item) => {
    const activeClass = item.key === activeKey ? "active" : "";
    const label = lang === "en" ? item.en : item.zh;
    return `<a class="${activeClass}" href="${pageHref(item.base, lang)}">${label}</a>`;
  }).join("");
}

function renderLangSwitch(base, lang) {
  const zhActive = lang === "zh" ? "active" : "";
  const enActive = lang === "en" ? "active" : "";
  return `
    <div class="lang-switch">
      <a class="${zhActive}" href="${pageHref(base, "zh")}">中文</a>
      <a class="${enActive}" href="${pageHref(base, "en")}">EN</a>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  const lang = detectLangFromPath(window.location.pathname);
  const base = resolvePageBase(window.location.pathname);
  const page = document.body.dataset.page || "home";

  const nav = document.querySelector("[data-nav]");
  if (nav) nav.innerHTML = renderNav(page, lang);

  const langSwitch = document.querySelector("[data-lang-switch]");
  if (langSwitch) langSwitch.innerHTML = renderLangSwitch(base, lang);

  const footerYear = document.querySelector("[data-year]");
  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
});
