# Phase 0 开发 Review 记录

> 评审日期：2026-03-14
> 评审范围：Phase 0 monorepo/bootstrap 工作区变更
> 当前结论：未通过，存在阻塞后续阶段的基线问题

## 1. 结论

Phase 0 已完成基础脚手架铺设，但当前工作区还不满足“基线命令可稳定通过”的要求。

本轮 review 发现 2 个高优先级问题和 2 个中优先级问题，需要先修复，再进入下一阶段。

## 2. Findings

### 2.1 High

- `pnpm lint` 当前无法运行
  - `eslint.config.js` 使用了 `@eslint/js` 和 `typescript-eslint` flat config 入口，但根目录 `devDependencies` 未声明这两个包。
  - 相关文件：
    - `eslint.config.js`
    - `package.json`
  - 风险：
    - Phase 0 不能提供可执行的 lint 基线，CI/本地校验都会直接失败。

- `pnpm build` 当前无法通过
  - `apps/local-ui` 的 `build` 脚本执行 `vite build`，但包内只有占位的 `src/index.ts`，没有 `index.html` 或等价入口。
  - 相关文件：
    - `apps/local-ui/package.json`
    - `apps/local-ui/src/index.ts`
  - 风险：
    - 根构建命令失败，monorepo bootstrap 不能作为后续阶段的稳定起点。

### 2.2 Medium

- `pnpm test` 在当前空骨架下稳定失败
  - 根脚本直接执行 `vitest run`，但当前配置只匹配测试文件，仓库里尚无任何 `.test.ts`。
  - 相关文件：
    - `package.json`
    - `vitest.config.ts`
  - 风险：
    - Phase 0 无法提供“开箱即绿”的测试基线。

- AI 约束文件默认不会被版本库收录
  - `.gitignore` 当前忽略 `.kiro/`、`AGENTS.md` 等关键约束文件。
  - 相关文件：
    - `.gitignore`
  - 风险：
    - 后续新增的 Kiro steering / hook / 约束配置容易被静默遗漏，削弱实现阶段的设计约束。

## 3. 验证结果

本轮实际执行结果如下：

- `pnpm -r typecheck`
  - 结果：通过
- `pnpm lint`
  - 结果：失败
  - 关键信息：`ERR_MODULE_NOT_FOUND`，缺少 `@eslint/js`
- `pnpm build`
  - 结果：失败
  - 关键信息：`apps/local-ui` 缺少 `index.html` 入口，`vite build` 无法解析 entry module
- `pnpm test`
  - 结果：失败
  - 关键信息：`No test files found`

## 4. 修复建议

- 补齐 ESLint flat config 所需依赖，或改回当前依赖集可支持的配置写法。
- 在 `apps/local-ui` 中补最小可构建 Vite 入口，或在 Phase 0 前暂时将其排除出 root `build`。
- 为空脚手架补一个 smoke test，或显式配置 `vitest` 在无测试文件时返回成功。
- 调整 `.gitignore`，保证 `.kiro/` 与项目级 AI 约束文件默认可被纳入版本控制。

## 5. 后续要求

建议在 Phase 0 修复完成后，重新执行以下基线命令并记录结果：

- `pnpm -r typecheck`
- `pnpm lint`
- `pnpm build`
- `pnpm test`
