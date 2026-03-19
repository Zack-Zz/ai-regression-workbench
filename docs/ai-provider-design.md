# AI Provider 多提供商与场景路由设计

## 1. 目标

- 支持同时配置多个 AI provider（OpenAI、DeepSeek 等 OpenAI 兼容接口）
- 运行时可通过 Settings 页面切换激活 provider，无需重启
- 支持“同一 provider 多模型分工”（按场景路由）
- `llm.decide` 等结构化场景支持 JSON mode / tool-calls / 空响应重试
- API Key 在设置接口返回时脱敏（`**masked**`）

## 2. 配置结构

### 2.1 `PersonalSettings.ai`

```ts
type AIProviderScene =
  | 'explorationDecision'
  | 'explorationLogin'
  | 'failureAnalysis'
  | 'findingSummary'
  | 'testDraft'
  | 'codeTaskDraft';

ai: {
  activeProvider: string;
  enabled: boolean;
  promptTemplatesDir?: string;
  sceneProviders?: Partial<Record<AIProviderScene, string>>;
  providers: {
    [key: string]: {
      baseUrl: string;
      model: string;
      apiKey?: string;
      apiKeyEnvVar?: string;
    };
  };
};
```

### 2.2 默认值

```yaml
ai:
  activeProvider: openai
  enabled: true
  sceneProviders:
    explorationDecision: openai
    explorationLogin: openai
    failureAnalysis: openai
    findingSummary: openai
    testDraft: openai
    codeTaskDraft: openai
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

## 3. 安全策略

- `apiKey` 明文只保存在本地 `config.local.yaml`（不进版本库）
- `getSettings()` 返回前，将 `providers[*].apiKey` 替换为 `**masked**`
- `updateSettings()` 收到 `**masked**` 不覆盖原值
- 运行日志不记录明文 key

## 4. Provider 抽象

```ts
interface AICompletionOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' };
  tools?: Array<{ type: 'function'; function: { name: string; parameters: object; strict?: boolean } }>;
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };
  retry?: { maxAttempts?: number; retryOnEmpty?: boolean };
  scene?: AIProviderScene;
}

interface AIProvider {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  isConfigured(): boolean;
  model?: string;
}
```

### 4.1 OpenAICompatibleProvider

- 统一调用 `POST /chat/completions`
- 支持 `response_format`、`tools`、`tool_choice`、`max_tokens`
- 支持空响应重试
- 输出提取优先级：
  1. `tool_calls[0].function.arguments`
  2. `message.content`

### 4.2 RoutedAIProvider

- 底层维护多个 provider 实例（来自 `ai.providers`）
- `complete(prompt, { scene })` 时按 `sceneProviders[scene]` 路由
- 未命中 scene 时回退 `activeProvider`

## 5. 运行时热更新

- `PUT /settings` 后 `ConfigManager.broadcast()`
- `server.ts` 在 `onConfigUpdated` 中重建 provider（含路由）
- `LocalAIEngine.setProvider(newProvider)` 热替换生效

## 6. Settings UI

Settings 页面 AI 区包含两层：

- 默认 provider：`activeProvider`
- 场景路由：`sceneProviders.*`
  - explorationDecision
  - explorationLogin
  - failureAnalysis
  - findingSummary
  - testDraft
  - codeTaskDraft

推荐配置（DeepSeek）：

- 配置两个 provider key：`deepseek_chat`、`deepseek_reasoner`
- `activeProvider=deepseek_chat`
- 将 `explorationDecision/explorationLogin` 绑定到 `deepseek_chat`
- 将 `failureAnalysis` 绑定到 `deepseek_reasoner`（可选）

## 7. 影响范围

| 层 | 文件 | 变更 |
|---|---|---|
| shared-types | `services.ts` | `ai.sceneProviders` 与 scene 类型 |
| config | `defaults.ts` | 默认 scene 路由 |
| config | `config-manager.ts` | scene provider 合法性校验 |
| ai-engine | `ai-engine.ts` | `AICompletionOptions`、`RoutedAIProvider`、结构化调用 |
| local-ui | `SettingsPage.tsx` | 场景路由选择 UI |
| local-ui | `i18n.ts` | 场景路由文案 |

