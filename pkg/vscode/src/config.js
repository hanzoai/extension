"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = void 0;
const configs = {
    development: {
        apiUrl: 'http://localhost:3000/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        }
    },
    production: {
        apiUrl: 'https://api.hanzo.ai/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        }
    }
};
const getConfig = () => {
    const env = process.env.VSCODE_ENV || 'production';
    return configs[env] || configs.production;
};
exports.getConfig = getConfig;
//# sourceMappingURL=config.js.map
