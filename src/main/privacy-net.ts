/**
 * PersonalIDE - Privacy Network Interceptor
 */
import { session, net } from 'electron';

const ALLOWED_DOMAINS = new Set<string>([
  'localhost', '127.0.0.1', 'api.deepseek.com', 'openai.com',
  'api.openai.com', 'ollama.localhost',
]);

export class PrivacyNet {
  enable(): void {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      try {
        const url = new URL(details.url);
        if (url.protocol === 'file:' || url.protocol === 'devtools:') {
          callback({});
          return;
        }
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          callback({});
          return;
        }
        if (!this.isAllowed(url.hostname)) {
          console.warn(`[PrivacyNet] Blocked: ${details.url}`);
          callback({ cancel: true });
          return;
        }
      } catch {
        callback({});
        return;
      }
      callback({});
    });
    console.log('[PrivacyNet] Enabled');
  }

  addAllowedDomain(domain: string): void {
    ALLOWED_DOMAINS.add(domain.replace(/^https?:\/\//, '').split('/')[0]);
  }

  isAllowed(hostname: string): boolean {
    return Array.from(ALLOWED_DOMAINS).some(d => hostname === d || hostname.endsWith('.' + d));
  }
}
