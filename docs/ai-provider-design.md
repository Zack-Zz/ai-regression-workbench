# AI Provider 多提供商设计

## 1. 目标

- 支持同时配置多个 AI provider（OpenAI、DeepSeek 等 OpenAI 兼容接口）
- 运行时可通过 Settings 页面切换激活的 provider，无需重启
- API Key 直接在页面配置，存储时脱敏展示（`**masked**`）
- 新增 provider 只需加一行配置，不改业务逻辑

## 2. 配置结构变更

### 2.1 PersonalSettings.ai（`packages/shared-types/src/services.ts`）

```ts
ai: {
  activeProvider: string;           // 当前激活的 provider key，如 'openai' | 'deepseek'
  enabled: boolean;
  promptTemplatesDir?: string;
  providers: {
    [key: string]: AIProviderConfig; // key 与 activeProvider 对应
  };
};

interface AIProviderConfig {
  baseUrl: string;       // API 端点，如 https://api.openai.com/v1
  model: string;         // 默认模型
  apiKey?: string;       // 直接存储的 key（脱敏后返回）
  apiKeyEnvVar?: string; // 备用：从环境变量读取
}
```

### 2.2 默认值（`packages/config/src/defaults.ts`）

```yaml
ai:
  activeProvider: openai
  enabled: true
  providers:
    openai:
      baseUrl: https://api.openai.com/v1
      model: gpt-4o
      apiKeyEnvVar: OPENAI_API_KEY
    deepseek:
      baseUrl: https://api.deepseek.com/v1
      model: deepseek-chat
      apiKeyEnvVar: DEEPSEEK_API_KEY
```

## 3. API Key 安全处理

### 3.1 存储

- `apiKey` 明文存入 `config.local.yaml`（本地文件，不进版本库）
- 优先级：`apiKey` > `apiKeyEnvVar` 环境变量

### 3.2 脱敏规则

- `getSettings()` 返回前，将所有 `providers[*].apiKey` 替换为 `**masked**`（若有值）
- `updateSettings()` 收到 `**masked**` 时，跳过该字段不覆盖原值
- 前端展示时直接渲染返回值，无需额外处理

## 4. AIProvider 实现层

### 4.1 接口不变

```ts
interface AIProvider {
  complete(prompt: string): Promise<string>;
}
```

### 4.2 OpenAICompatibleProvider（新增，替代 OpenAIProvider）

```ts
class OpenAICompatibleProvider implements AIProvider {
  constructor(baseUrl: string, apiKey: string, model: string) {}
  async complete(prompt: string): Promise<string> { /* fetch baseUrl/chat/completions */ }
}
```

OpenAI 和 DeepSeek 均通过此类实例化，只传不同的 `baseUrl` 和 `model`。

### 4.3 createAIProvider 工厂

```ts
function createAIProvider(cfg: PersonalSettings['ai']): AIProvider {
  const providerCfg = cfg.providers[cfg.activeProvider];
  if (!providerCfg || !cfg.enabled) return new NullAIProvider();
  const apiKey = providerCfg.apiKey
    || (providerCfg.apiKeyEnvVar ? process.env[providerCfg.apiKeyEnvVar] ?? '' : '');
  return new OpenAICompatibleProvider(providerCfg.baseUrl, apiKey, providerCfg.model);
}
```

## 5. 运行时切换

### 5.1 切换机制

`PUT /settings` 传入 `{ patch: { ai: { activeProvider: 'deepseek' } } }` 即可切换。

`ConfigManager.updateSettings()` 完成后调用 `broadcast()`，`server.ts` 监听 `onConfigUpdated` 重建 `AIProvider` 并更新 `LocalAIEngine`。

### 5.2 server.ts 变更

```ts
// LocalAIEngine 暴露 setProvider(provider: AIProvider) 方法
settingsSvc.onConfigUpdated = (snapshot) => {
  const newProvider = createAIProvider(snapshot.values.ai);
  aiEngine.setProvider(newProvider);
};
```

## 6. Settings UI 变更（`SettingsPage.tsx`）

AI 配置区展示：

- `activeProvider`：下拉选择（枚举已配置的 provider key）
- 每个 provider 展示：
  - `baseUrl`：文本输入
  - `model`：文本输入
  - `apiKey`：密码输入框（`type="password"`），展示 `**masked**` 时禁止提交原值
  - `apiKeyEnvVar`：文本输入（备用）

## 7. 影响范围

| 层 | 文件 | 变更类型 |
|---|---|---|
| shared-types | `services.ts` | `PersonalSettings.ai` 结构变更 |
| config | `defaults.ts` | 默认值更新 |
| config | `config-manager.ts` | `getSettings` 脱敏 + `updateSettings` 跳过 masked |
| ai-engine | `ai-engine.ts` | 新增 `OpenAICompatibleProvider`，重构 `createAIProvider`，`LocalAIEngine.setProvider()` |
| cli | `server.ts` | `onConfigUpdated` 重建 provider |
| local-ui | `SettingsPage.tsx` | 多 provider 配置 UI |
| local-ui | `i18n.ts` | 新增 i18n key |

## 8. 不影响的模块

- `LocalAIEngine` 业务逻辑（`analyzeFailure` 等方法）
- `RunService`、`DiagnosticsService`
- 所有 repository
- API contract（`/settings` 端点已存在）
- 测试（除 config 相关单元测试）

## 9. 约束

- `apiKey` 不得出现在日志或 API 响应中（除 `**masked**` 占位符）
- 切换 provider 不中断正在运行的 Run（当前 Run 用切换前的 provider 完成）
- `NullAIProvider` 在无有效 key 时降级，不抛出异常
