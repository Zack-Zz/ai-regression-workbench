# UI Preview

这是基于设计文档生成的静态预览原型，页面不依赖后端接口。
支持中文/英文切换（页面右上角 `中文 / EN`）。导航菜单仅显示菜单名称；页面内模块标题与说明会随语言切换。

## 页面

- `index.html`：Home / Workbench
- `run-list.html`：Run List
- `run-detail.html`：Run Detail
- `failure-report.html`：Failure Report
- `code-task-detail.html`：CodeTask Detail
- `review-commit.html`：Review / Commit
- `settings.html`：Settings
- 对应英文页为 `*.en.html`

当前预览已同步到最新设计中的关键约束：

- `QuickRunPanel` 的 `runMode + selectorType + selectorValue`
- Run List 的 `runMode` 列与分页提示
- Run Detail 中 findings 内嵌、hybrid/exploration 阶段与 execution report / execution profile 链接
- Review / Commit 中 `codeTaskVersion`、`expectedTaskVersion`、verify override 约束

## 本地预览

在仓库根目录执行：

```bash
python3 -m http.server 3910
```

然后访问：

- `http://127.0.0.1:3910/docs/ui-preview/index.html`
