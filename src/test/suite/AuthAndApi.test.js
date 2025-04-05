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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const client_1 = require("../../api/client");
const manager_1 = require("../../auth/manager");
suite('Auth and API Test Suite', () => {
    // Shared context and managers
    let context;
    let authManager;
    let apiClient;
    let testUserId = null;
    setup(function () {
        this.timeout(60000); // 60 seconds for each test
        // Create fresh context for each test
        context = {
            globalState: new Map(),
            subscriptions: []
        };
        authManager = manager_1.AuthManager.getInstance(context);
        apiClient = new client_1.ApiClient(context);
    });
    // Cleanup after all tests
    suiteTeardown(async function () {
        this.timeout(60000); // 60 seconds for cleanup
        if (testUserId) {
            console.log('Cleaning up test user:', testUserId);
            await authManager.logout();
        }
    });
    test('Should create new anonymous user', async function () {
        console.log('Testing anonymous user creation...');
        // Clear any existing session
        await context.globalState.set('supabaseSession', undefined);
        const token = await authManager.getAuthToken();
        console.log('Got auth token:', token ? 'yes' : 'no');
        // Mark as test user
        testUserId = await authManager.markAsTestUser();
        console.log('Marked as test user:', testUserId);
        assert.ok(testUserId, 'Should have test user ID');
        assert.ok(token, 'Should get auth token for anonymous user');
        assert.strictEqual(typeof token, 'string', 'Token should be string');
    });
    test('Should set trial period for new user', async function () {
        console.log('Testing trial period setup...');
        const hasValidTrial = await authManager.checkTrialStatus();
        console.log('Trial status:', hasValidTrial);
        assert.strictEqual(hasValidTrial, true, 'New user should have valid trial');
    });
    test('Should make authenticated API request', async function () {
        console.log('Testing API request...');
        const response = await apiClient.makeAuthenticatedRequest('/health', {});
        console.log('API Response:', {
            success: response.data?.success,
            hasData: !!response.data,
            status: response.status,
            userId: testUserId
        });
        assert.ok(response.data, 'Response should have data');
        assert.ok(response.data.success, 'API request should succeed');
    });
    test('Should persist auth token between requests', async function () {
        console.log('Testing auth token persistence...');
        // Get initial token
        const token1 = await authManager.getAuthToken();
        console.log('Got first token');
        // Get token again - should be same one
        const token2 = await authManager.getAuthToken();
        console.log('Got second token');
        assert.strictEqual(token1, token2, 'Should reuse same token');
    });
    test('Should handle API errors gracefully', async function () {
        console.log('Testing error handling...');
        try {
            await apiClient.makeAuthenticatedRequest('/invalid/endpoint', { data: 'test' });
            assert.fail('Should throw error for invalid endpoint');
        }
        catch (error) {
            console.log('Got expected error:', error.message);
            assert.ok(error, 'Should throw error');
            assert.ok(error.message, 'Error should have message');
        }
    });
});
//# sourceMappingURL=AuthAndApi.test.js.map