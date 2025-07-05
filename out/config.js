"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = void 0;
const vscode = __importStar(require("vscode"));
const configs = {
    development: {
        apiUrl: 'http://localhost:3000/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        },
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'tcp',
            disableWriteTools: false,
            disableSearchTools: false
        },
        debug: true
    },
    production: {
        apiUrl: 'https://api.hanzo.ai/ext/v1',
        auth: {
            baseUrl: 'https://auth.hanzo.ai',
            startEndpoint: '/start',
            checkEndpoint: '/api/check-auth'
        },
        mcp: {
            enabled: true,
            port: 3000,
            transport: 'stdio',
            disableWriteTools: false,
            disableSearchTools: false
        },
        debug: false
    }
};
const getConfig = () => {
    const env = process.env.VSCODE_ENV || 'production';
    const baseConfig = configs[env] || configs.production;
    // Override with VS Code settings if available
    try {
        const vsConfig = vscode.workspace.getConfiguration('hanzo');
        return {
            ...baseConfig,
            apiUrl: vsConfig.get('api.endpoint', baseConfig.apiUrl),
            mcp: {
                ...baseConfig.mcp,
                enabled: vsConfig.get('mcp.enabled', baseConfig.mcp.enabled),
                port: vsConfig.get('mcp.port', baseConfig.mcp.port),
                transport: vsConfig.get('mcp.transport', baseConfig.mcp.transport),
                allowedPaths: vsConfig.get('mcp.allowedPaths'),
                disableWriteTools: vsConfig.get('mcp.disableWriteTools', baseConfig.mcp.disableWriteTools || false),
                disableSearchTools: vsConfig.get('mcp.disableSearchTools', baseConfig.mcp.disableSearchTools || false),
                enabledTools: vsConfig.get('mcp.enabledTools'),
                disabledTools: vsConfig.get('mcp.disabledTools')
            },
            debug: vsConfig.get('debug', baseConfig.debug)
        };
    }
    catch {
        // If VS Code API is not available (e.g., in tests), use base config
        return baseConfig;
    }
};
exports.getConfig = getConfig;
//# sourceMappingURL=config.js.map