"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrivacyNet = void 0;
/**
 * PersonalIDE - Privacy Network Interceptor
 */
const electron_1 = require("electron");
const ALLOWED_DOMAINS = new Set([
    'localhost', '127.0.0.1', 'api.deepseek.com', 'openai.com',
    'api.openai.com', 'ollama.localhost',
]);
class PrivacyNet {
    enable() {
        electron_1.session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
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
