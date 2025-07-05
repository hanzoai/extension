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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiClient = void 0;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const zlib = __importStar(require("zlib"));
const manager_1 = require("../auth/manager");
const config_1 = require("../config");
// Constants for chunking
const MAX_BODY_SIZE_PER_REQUEST = 4 * 1024 * 1024; // 4MB in bytes
// Global timeout constant (5 minutes)
const GLOBAL_REQUEST_TIMEOUT = 300000; // 300 seconds
class ApiClient {
    constructor(context) {
        this.config = (0, config_1.getConfig)();
        this.authManager = manager_1.AuthManager.getInstance(context);
    }
    async makeAuthenticatedRequest(endpoint, data, options = {}) {
        let token = null;
        try {
            token = await this.authManager.getAuthToken();
        }
        catch (error) {
            console.error('[Hanzo] Auth failed, proceeding without authentication:', error);
        }
        // Log basic info about the data without using Object.keys
        if (data.files) {
            console.info(`[Hanzo] Request contains ${data.files.length} files`);
        }
        console.warn('[Hanzo] Request data:', JSON.stringify(data, null, 2));
        // Stringify the body
        let jsonBody;
        try {
            jsonBody = JSON.stringify(data);
            console.info(`[Hanzo] Request body size: ${(jsonBody.length / (1024 * 1024)).toFixed(2)} MB`);
        }
        catch (error) {
            console.error('Failed to stringify request body:', error);
            throw new Error('Project is too large to process. Try removing some files or directories.');
        }
        // Check if we need to use chunking (for non-gzipped requests)
        if (!options.shouldGzip && !endpoint.includes('refine') && jsonBody.length > MAX_BODY_SIZE_PER_REQUEST) {
            console.info(`[Hanzo] Request body exceeds ${MAX_BODY_SIZE_PER_REQUEST / (1024 * 1024)}MB, using chunked upload`);
            // Ensure we're passing the original data structure, not just the stringified version
            // return this.makeGzippedChunkedRequest(endpoint, data, token, 0.5, options);
            return this.makeChunkedRequest(endpoint, data, token, options);
        }
        // For gzipped requests, check if the compressed size exceeds the limit
        if (options.shouldGzip) {
            // Compress the content
            const compressedBody = this.gzipContent(jsonBody);
            const compressedSize = Buffer.from(compressedBody, 'base64').length;
            console.info(`[Hanzo] Compressed body size: ${(compressedSize / (1024 * 1024)).toFixed(2)} MB`);
            // If compressed size exceeds the limit, use chunking with gzip
            if (compressedSize > MAX_BODY_SIZE_PER_REQUEST) {
                console.info(`[Hanzo] Compressed body exceeds ${MAX_BODY_SIZE_PER_REQUEST / (1024 * 1024)}MB, using chunked upload with gzip`);
                // Calculate compression ratio to use as a heuristic for chunking
                const compressionRatio = compressedSize / jsonBody.length;
                console.info(`[Hanzo] Compression ratio: ${compressionRatio.toFixed(4)}`);
                return this.makeGzippedChunkedRequest(endpoint, data, token, compressionRatio, options);
            }
            // If compressed size is within limits, use the compressed body
            const body = compressedBody;
            // Make the request with progress
            const makeRequest = async () => {
                try {
                    const headers = {
                        'Authorization': token ? `Bearer ${token}` : undefined,
                        'Content-Type': 'application/gzip',
                        'Content-Encoding': 'gzip',
                        'Accept': 'application/json'
                    };
                    const response = await axios_1.default.post(`${this.config.apiUrl}${endpoint}`, body, {
                        headers: headers,
                        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                        timeout: GLOBAL_REQUEST_TIMEOUT
                    });
                    return response;
                }
                catch (error) {
                    console.error('[Hanzo] API request failed:', JSON.stringify({
                        endpoint,
                        error: axios_1.default.isAxiosError(error) ? {
                            message: error.message,
                            status: error.response?.status,
                            data: error.response?.data,
                        } : String(error),
                        stack: error instanceof Error ? error.stack : undefined
                    }));
                    if (axios_1.default.isAxiosError(error)) {
                        // Check specifically for timeout errors
                        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                            console.error(`[Hanzo] Request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds`);
                            throw new Error(`API request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds. This may happen with large projects or complex specifications. Try again or consider breaking your project into smaller parts.`);
                        }
                        throw new Error(`API request failed: ${error.response?.data?.message || error.response?.data || error.message}`);
                    }
                    throw error;
                }
            };
            // If progress location is specified, show progress
            if (options.progressLocation) {
                return vscode.window.withProgress({ location: options.progressLocation }, async () => makeRequest());
            }
            return makeRequest();
        }
        // For non-gzipped requests that don't need chunking
        const body = jsonBody;
        // Make the request with progress
        const makeRequest = async () => {
            try {
                const headers = {
                    'Authorization': token ? `Bearer ${token}` : undefined,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };
                const response = await axios_1.default.post(`${this.config.apiUrl}${endpoint}`, body, {
                    headers: headers,
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                    timeout: GLOBAL_REQUEST_TIMEOUT
                });
                return response;
            }
            catch (error) {
                console.error('[Hanzo] API request failed:', JSON.stringify({
                    endpoint,
                    error: axios_1.default.isAxiosError(error) ? {
                        message: error.message,
                        status: error.response?.status,
                        data: error.response?.data,
                    } : String(error),
                    stack: error instanceof Error ? error.stack : undefined
                }));
                if (axios_1.default.isAxiosError(error)) {
                    // Check specifically for timeout errors
                    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                        console.error(`[Hanzo] Request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds`);
                        throw new Error(`API request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds. This may happen with large projects or complex specifications. Try again or consider breaking your project into smaller parts.`);
                    }
                    throw new Error(`API request failed: ${error.response?.data?.message || error.response?.data || error.message}`);
                }
                throw error;
            }
        };
        // If progress location is specified, show progress
        if (options.progressLocation) {
            return vscode.window.withProgress({ location: options.progressLocation }, async () => makeRequest());
        }
        return makeRequest();
    }
    /**
     * Compresses content using gzip and returns it as a base64 string
     * @param content Content to compress
     * @returns Base64 encoded gzipped content
     */
    gzipContent(content) {
        return Buffer.from(zlib.gzipSync(Buffer.from(content))).toString('base64');
    }
    /**
     * Makes a chunked request when the data size exceeds the maximum allowed size
     * @param endpoint API endpoint
     * @param originalData Original data object
     * @param token Authentication token
     * @param options Request options
     * @returns API response
     */
    async makeChunkedRequest(endpoint, originalData, token, options) {
        if (typeof originalData === 'string') {
            originalData = JSON.parse(originalData);
        }
        console.warn('[Hanzo] Entering makeChunkedRequest');
        console.warn('[Hanzo] Has files property:', originalData.hasOwnProperty('files'));
        console.warn('[Hanzo] Files is array:', Array.isArray(originalData.files));
        if (originalData.files && Array.isArray(originalData.files)) {
            console.warn(`[Hanzo] Files array length: ${originalData.files.length}`);
        }
        let dataToChunk = originalData;
        console.warn(`[Hanzo] Data to chunk: ${JSON.stringify(dataToChunk, null, 2)}`);
        // Now check if we have files to chunk
        console.warn(`[Hanzo] Chunking ${dataToChunk.files.length} files for upload`);
        // Create a copy of the data without files
        const baseData = { ...dataToChunk };
        delete baseData.files;
        // Split files into chunks
        const fileChunks = this.chunkArray(dataToChunk.files, MAX_BODY_SIZE_PER_REQUEST);
        console.log(`[Hanzo] Split files into ${fileChunks.length} chunks`);
        // Prepare for chunked upload
        const totalChunks = fileChunks.length;
        let chunkResponses = [];
        // Function to make a request for a single chunk
        const makeChunkRequest = async (chunkIndex, filesChunk) => {
            const chunkData = {
                ...baseData,
                files: filesChunk,
                chunkInfo: {
                    index: chunkIndex,
                    total: totalChunks
                }
            };
            const chunkJsonBody = JSON.stringify(chunkData);
            console.info(`[Hanzo] Sending chunk ${chunkIndex + 1}/${totalChunks}, size: ${(chunkJsonBody.length / (1024 * 1024)).toFixed(2)} MB`);
            const headers = {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Chunk-Index': chunkIndex.toString(),
                'X-Total-Chunks': totalChunks.toString()
            };
            try {
                const response = await axios_1.default.post(`${this.config.apiUrl}${endpoint}`, chunkJsonBody, {
                    headers,
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                    timeout: GLOBAL_REQUEST_TIMEOUT
                });
                return response;
            }
            catch (error) {
                console.error(`[Hanzo] Chunk ${chunkIndex + 1}/${totalChunks} upload failed:`, {
                    error: axios_1.default.isAxiosError(error) ? {
                        message: error.message,
                        status: error.response?.status,
                        data: error.response?.data,
                    } : String(error)
                });
                if (axios_1.default.isAxiosError(error)) {
                    // Check specifically for timeout errors
                    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                        console.error(`[Hanzo] Chunk request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds`);
                        throw new Error(`API request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds for chunk ${chunkIndex + 1}/${totalChunks}. This may happen with large projects or complex specifications.`);
                    }
                    throw new Error(`API request failed for chunk ${chunkIndex + 1}/${totalChunks}: ${error.response?.data?.message || error.response?.data || error.message}`);
                }
                throw error;
            }
        };
        // If progress location is specified, show progress
        if (options.progressLocation) {
            return vscode.window.withProgress({
                location: options.progressLocation,
                title: 'Uploading project data in chunks'
            }, async (progress) => {
                for (let i = 0; i < fileChunks.length; i++) {
                    progress.report({
                        message: `Sending chunk ${i + 1} of ${totalChunks}`,
                        increment: (100 / totalChunks)
                    });
                    const response = await makeChunkRequest(i, fileChunks[i]);
                    chunkResponses.push(response);
                }
                // Combine all chunk responses into a single response
                return this.combineChunkResponses(chunkResponses);
            });
        }
        else {
            // Without progress reporting
            for (let i = 0; i < fileChunks.length; i++) {
                const response = await makeChunkRequest(i, fileChunks[i]);
                chunkResponses.push(response);
            }
            // Combine all chunk responses into a single response
            return this.combineChunkResponses(chunkResponses);
        }
    }
    /**
     * Combines multiple chunk responses into a single consolidated response
     * @param responses Array of chunk responses
     * @returns Combined response
     */
    combineChunkResponses(responses) {
        if (responses.length === 0) {
            throw new Error('No chunk responses received');
        }
        if (responses.length === 1) {
            console.info('[Hanzo] Only one chunk response, returning directly');
            return responses[0]; // If only one chunk, return it directly
        }
        console.info(`[Hanzo] Combining ${responses.length} chunk responses`);
        // Use the first response as the base
        const baseResponse = responses[0];
        // Create a deep copy of the first response to avoid modifying the original
        const combinedResponse = {
            ...baseResponse,
            data: { ...baseResponse.data }
        };
        // If the response contains files or other arrays that need to be combined
        if (baseResponse.data && typeof baseResponse.data === 'object') {
            // Log that we're starting to combine responses without using Object.keys
            console.info('[Hanzo] Starting to combine response data');
            // Known keys that might be in the response data
            const knownKeys = ['success', 'message', 'specification', 'files', 'error'];
            // Combine data from all responses
            for (let i = 1; i < responses.length; i++) {
                const currentResponse = responses[i];
                // Skip if response has no data
                if (!currentResponse.data) {
                    console.warn(`[Hanzo] Chunk ${i} has no data, skipping`);
                    continue;
                }
                console.info(`[Hanzo] Processing chunk ${i} response`);
                // Process known keys that might be in the response
                for (const key of knownKeys) {
                    if (currentResponse.data.hasOwnProperty(key)) {
                        const value = currentResponse.data[key];
                        // If the property is an array, concatenate it
                        if (Array.isArray(value)) {
                            if (!combinedResponse.data[key]) {
                                combinedResponse.data[key] = [];
                            }
                            console.info(`[Hanzo] Concatenating array for key '${key}', adding ${value.length} items`);
                            combinedResponse.data[key] = combinedResponse.data[key].concat(value);
                        }
                        // If it's an object with content property (like specification or message)
                        else if (value && typeof value === 'object' && value.content) {
                            if (!combinedResponse.data[key]) {
                                combinedResponse.data[key] = { content: '', timestamp: value.timestamp };
                                console.info(`[Hanzo] Creating new content object for key '${key}'`);
                            }
                            else {
                                console.info(`[Hanzo] Appending content for key '${key}'`);
                            }
                            // Append content
                            combinedResponse.data[key].content += value.content;
                        }
                        // For other properties, use the latest value
                        else {
                            console.info(`[Hanzo] Using latest value for key '${key}'`);
                            combinedResponse.data[key] = value;
                        }
                    }
                }
            }
        }
        console.info('[Hanzo] Successfully combined chunk responses');
        return combinedResponse;
    }
    /**
     * Makes a chunked request with gzip compression when the compressed data size exceeds the maximum allowed size
     * @param endpoint API endpoint
     * @param originalData Original data object
     * @param token Authentication token
     * @param compressionRatio Observed compression ratio to use as a heuristic
     * @param options Request options
     * @returns API response
     */
    async makeGzippedChunkedRequest(endpoint, originalData, token, compressionRatio, options) {
        console.log('[Hanzo] Entering makeGzippedChunkedRequest');
        if (typeof originalData === 'string') {
            originalData = JSON.parse(originalData);
        }
        if (!originalData.files || !Array.isArray(originalData.files)) {
            console.error('[Hanzo] No files array found in data');
            throw new Error('Invalid data structure for chunked upload');
        }
        console.log(`[Hanzo] Files array length: ${originalData.files.length}`);
        // Create a copy of the data without files
        const baseData = { ...originalData };
        delete baseData.files;
        // Calculate estimated chunk size based on compression ratio
        // We want each compressed chunk to be under MAX_BODY_SIZE_PER_REQUEST
        // So we estimate the raw size that would compress to our target
        const estimatedMaxRawChunkSize = MAX_BODY_SIZE_PER_REQUEST / compressionRatio;
        // Add some safety margin (80% of the calculated size) to account for variations in compression ratio
        const targetRawChunkSize = estimatedMaxRawChunkSize * 0.8;
        console.log(`[Hanzo] Using compression ratio ${compressionRatio.toFixed(4)} to estimate chunk sizes`);
        console.log(`[Hanzo] Target raw chunk size: ${(targetRawChunkSize / (1024 * 1024)).toFixed(2)} MB`);
        // Split files into chunks based on the estimated raw size
        const fileChunks = this.chunkArray(originalData.files, targetRawChunkSize);
        console.log(`[Hanzo] Split files into ${fileChunks.length} chunks for gzipped upload`);
        // Prepare for chunked upload
        const totalChunks = fileChunks.length;
        let chunkResponses = [];
        // Function to make a request for a single gzipped chunk
        const makeGzippedChunkRequest = async (chunkIndex, filesChunk) => {
            const chunkData = {
                ...baseData,
                files: filesChunk,
                chunkInfo: {
                    index: chunkIndex,
                    total: totalChunks
                }
            };
            const chunkJsonBody = JSON.stringify(chunkData);
            console.info(`[Hanzo] Preparing chunk ${chunkIndex + 1}/${totalChunks}, raw size: ${(chunkJsonBody.length / (1024 * 1024)).toFixed(2)} MB`);
            // Compress the chunk
            const compressedChunkBody = this.gzipContent(chunkJsonBody);
            const compressedSize = Buffer.from(compressedChunkBody, 'base64').length;
            console.info(`[Hanzo] Compressed chunk size: ${(compressedSize / (1024 * 1024)).toFixed(2)} MB`);
            const headers = {
                'Authorization': token ? `Bearer ${token}` : '',
                'Content-Type': 'application/gzip',
                'Content-Encoding': 'gzip',
                'Accept': 'application/json',
                'X-Chunk-Index': chunkIndex.toString(),
                'X-Total-Chunks': totalChunks.toString()
            };
            try {
                const response = await axios_1.default.post(`${this.config.apiUrl}${endpoint}`, compressedChunkBody, {
                    headers,
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                    timeout: GLOBAL_REQUEST_TIMEOUT
                });
                return response;
            }
            catch (error) {
                console.error(`[Hanzo] Gzipped chunk ${chunkIndex + 1}/${totalChunks} upload failed:`, {
                    error: axios_1.default.isAxiosError(error) ? {
                        message: error.message,
                        status: error.response?.status,
                        data: error.response?.data,
                    } : String(error)
                });
                if (axios_1.default.isAxiosError(error)) {
                    // Check specifically for timeout errors
                    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                        console.error(`[Hanzo] Gzipped chunk request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds`);
                        throw new Error(`API request timed out after ${GLOBAL_REQUEST_TIMEOUT / 1000} seconds for gzipped chunk ${chunkIndex + 1}/${totalChunks}. This may happen with large projects or complex specifications.`);
                    }
                    throw new Error(`API request failed for gzipped chunk ${chunkIndex + 1}/${totalChunks}: ${error.response?.data?.message || error.response?.data || error.message}`);
                }
                throw error;
            }
        };
        // If progress location is specified, show progress
        if (options.progressLocation) {
            return vscode.window.withProgress({
                location: options.progressLocation,
                title: 'Processing in chunks'
            }, async (progress) => {
                for (let i = 0; i < fileChunks.length; i++) {
                    progress.report({
                        message: `Sending compressed chunk ${i + 1} of ${totalChunks}`,
                        increment: (100 / totalChunks)
                    });
                    const response = await makeGzippedChunkRequest(i, fileChunks[i]);
                    chunkResponses.push(response);
                }
                // Combine all chunk responses into a single response
                return this.combineChunkResponses(chunkResponses);
            });
        }
        else {
            // Without progress reporting
            for (let i = 0; i < fileChunks.length; i++) {
                const response = await makeGzippedChunkRequest(i, fileChunks[i]);
                chunkResponses.push(response);
            }
            // Combine all chunk responses into a single response
            return this.combineChunkResponses(chunkResponses);
        }
    }
    /**
     * Splits an array into chunks based on the JSON size of each chunk
     * @param array Array to split
     * @param maxChunkSize Maximum size of each chunk in bytes
     * @returns Array of chunks
     */
    chunkArray(array, maxChunkSize) {
        const chunks = [];
        let currentChunk = [];
        let currentChunkSize = 0;
        console.info(`[Hanzo] Chunking array with ${array.length} items`);
        // Process items in batches to avoid memory issues
        const batchSize = 100; // Process 100 items at a time
        for (let batchStart = 0; batchStart < array.length; batchStart += batchSize) {
            const batchEnd = Math.min(batchStart + batchSize, array.length);
            console.info(`[Hanzo] Processing batch ${batchStart}-${batchEnd} of ${array.length} items`);
            for (let i = batchStart; i < batchEnd; i++) {
                const item = array[i];
                try {
                    // Calculate the size of the current item
                    const itemJson = JSON.stringify(item);
                    const itemSize = Buffer.from(itemJson).length;
                    // Log only for larger items to reduce console spam
                    if (itemSize > 100 * 1024) { // Only log for items > 100KB
                        console.info(`[Hanzo] Large item: ${(itemSize / (1024 * 1024)).toFixed(2)} MB, path: ${item.path || 'unknown'}`);
                    }
                    // If adding this item would exceed the chunk size, start a new chunk
                    if (currentChunkSize + itemSize > maxChunkSize && currentChunk.length > 0) {
                        console.info(`[Hanzo] Starting new chunk, size: ${(currentChunkSize / (1024 * 1024)).toFixed(2)} MB, items: ${currentChunk.length}`);
                        chunks.push(currentChunk);
                        currentChunk = [];
                        currentChunkSize = 0;
                    }
                    // Add the item to the current chunk
                    currentChunk.push(item);
                    currentChunkSize += itemSize;
                }
                catch (error) {
                    console.error(`[Hanzo] Error processing item at index ${i}:`, error);
                    // Skip this item if there's an error
                }
            }
        }
        // Add the last chunk if it's not empty
        if (currentChunk.length > 0) {
            console.info(`[Hanzo] Adding final chunk, size: ${(currentChunkSize / (1024 * 1024)).toFixed(2)} MB, items: ${currentChunk.length}`);
            chunks.push(currentChunk);
        }
        console.info(`[Hanzo] Created ${chunks.length} chunks`);
        return chunks;
    }
}
exports.ApiClient = ApiClient;
//# sourceMappingURL=client.js.map