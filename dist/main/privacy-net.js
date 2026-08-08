"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyNet = void 0;
/**
 * PersonalIDE - Privacy Network Interceptor
 */
const electron_1 = require("electron");
const ALLOWED_DOMAINS = new Set([
    'api.deepseek.com', 'openai.com',
    'api.openai.com', 'ollama.localhost',
]);
// 本地服务仅放行指定端口（Ollama 11434 / Vite 5173 / 本地调试 3000 / 8000）
const ALLOWED_LOCAL_PORTS = new Set([11434, 3000, 5173, 8000]);
class PrivacyNet {
    enable() {
        electron_1.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
            try {
                const url = new URL(details.url);
                if (url.protocol === 'file:' || url.protocol === 'devtools:') {
                    callback({});
                    return;
                }
                if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') {
                    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
                    if (ALLOWED_LOCAL_PORTS.has(port)) {
                        callback({});
                        return;
                    }
                    console.warn(`[PrivacyNet] Blocked localhost port: ${details.url}`);
                    callback({ cancel: true });
                    return;
                }
                if (!this.isAllowed(url.hostname)) {
                    console.warn(`[PrivacyNet] Blocked: ${details.url}`);
                    callback({ cancel: true });
                    return;
                }
            }
            catch {
                callback({});
                return;
            }
            callback({});
        });
        console.log('[PrivacyNet] Enabled');
    }
    addAllowedDomain(domain) {
        ALLOWED_DOMAINS.add(domain.replace(/^https?:\/\//, '').split('/')[0]);
    }
    isAllowed(hostname) {
        return Array.from(ALLOWED_DOMAINS).some(d => hostname === d || hostname.endsWith('.' + d));
    }
}
exports.PrivacyNet = PrivacyNet;
