import type { ToolRegistry } from '../runtime/tool-registry.js';
import type { DomSnapshot, PlaywrightToolProvider, PlaywrightToolProviderOptions, VerificationChallenge } from '../playwright-tool-provider.js';
import type { PageProbe } from './types.js';
import type { SiteCredentialRow } from '@zarb/storage';

export interface ExplorationBrowserAdapter {
  launch(opts?: PlaywrightToolProviderOptions): Promise<void>;
  registerTools(registry: ToolRegistry, opts?: PlaywrightToolProviderOptions): void;
  buildProbe(): (url: string) => Promise<PageProbe>;
  collectDomSnapshot(): Promise<DomSnapshot>;
  getRecentNetworkHighlights(limit?: number): string[];
  flushNetworkLog(filePath: string): void;
  close(): Promise<void>;
  getPage(): ReturnType<PlaywrightToolProvider['getPage']>;
  applyCredential(cred: SiteCredentialRow, baseUrl: string): Promise<void>;
  isHeaded(): boolean;
  getLatestVerificationChallenge(timeoutMs?: number): Promise<VerificationChallenge | undefined>;
}

export class PlaywrightExplorationBrowserAdapter implements ExplorationBrowserAdapter {
  constructor(private readonly provider: PlaywrightToolProvider) {}

  launch(opts?: PlaywrightToolProviderOptions): Promise<void> {
    return this.provider.launch(opts);
  }

  registerTools(registry: ToolRegistry, opts?: PlaywrightToolProviderOptions): void {
    this.provider.registerTools(registry, opts);
  }

  buildProbe(): (url: string) => Promise<PageProbe> {
    return this.provider.buildProbe();
  }

  collectDomSnapshot(): Promise<DomSnapshot> {
    return this.provider.collectDomSnapshot();
  }

  getRecentNetworkHighlights(limit?: number): string[] {
    return this.provider.getRecentNetworkHighlights(limit);
  }

  flushNetworkLog(filePath: string): void {
    this.provider.flushNetworkLog(filePath);
  }

  close(): Promise<void> {
    return this.provider.close();
  }

  getPage(): ReturnType<PlaywrightToolProvider['getPage']> {
    return this.provider.getPage();
  }

  applyCredential(cred: SiteCredentialRow, baseUrl: string): Promise<void> {
    return this.provider.applyCredential(cred, baseUrl);
  }

  isHeaded(): boolean {
    return this.provider.isHeaded();
  }

  getLatestVerificationChallenge(timeoutMs?: number): Promise<VerificationChallenge | undefined> {
    return this.provider.getLatestVerificationChallenge(timeoutMs);
  }
}
