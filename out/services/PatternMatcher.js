"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PatternMatcher = void 0;
const minimatch_1 = require("minimatch");
const config_1 = require("../constants/config");
class PatternMatcher {
    constructor() {
        this.patterns = [];
    }
    addPattern(pattern, source = '') {
        pattern = pattern.trim();
        if (!pattern || pattern.startsWith('#')) {
            return;
        }
        const isNegation = pattern.startsWith('!');
        if (isNegation) {
            pattern = pattern.slice(1);
        }
        // Normalize pattern
        pattern = pattern.replace(/^\/+/, ''); // Remove leading slashes
        if (pattern.endsWith('/')) {
            pattern = pattern + '**'; // Append ** to directory patterns
        }
        if (!pattern.includes('/') && !pattern.startsWith('**')) {
            pattern = '**/' + pattern; // Add **/ prefix to simple patterns
        }
        // For patterns from nested .gitignore files, prefix them with their source directory
        if (source && source !== 'default' && source !== 'root') {
            pattern = source + '/' + pattern;
        }
        this.patterns.push({ pattern, isNegation, source });
    }
    shouldIgnore(filePath) {
        // Always include specified paths
        if (config_1.CONFIG.ALWAYS_INCLUDE.some((p) => filePath === p || filePath.startsWith(p + '/'))) {
            return false;
        }
        // Normalize path
        const normalizedPath = filePath.replace(/^\/+/, '');
        // Get all directories in the path
        const pathParts = normalizedPath.split('/');
        const directories = pathParts.slice(0, -1);
        const allDirs = directories.map((_, index) => directories.slice(0, index + 1).join('/'));
        // Group patterns by source directory
        const patternsBySource = new Map();
        for (const pattern of this.patterns) {
            const key = pattern.source || 'root';
            if (!patternsBySource.has(key)) {
                patternsBySource.set(key, []);
            }
            patternsBySource.get(key).push(pattern);
        }
        // Process patterns from most specific to least specific source
        const sources = Array.from(patternsBySource.keys()).sort((a, b) => {
            if (a === 'default')
                return -1;
            if (b === 'default')
                return 1;
            return b.length - a.length;
        });
        let shouldBeIgnored = false;
        let hasMatchingNegation = false;
        // First, check all patterns in order of specificity
        for (const source of sources) {
            // Skip patterns from sources that don't apply to this path
            if (source !== 'root' && source !== 'default' && !normalizedPath.startsWith(source + '/')) {
                continue;
            }
            const sourcePatterns = patternsBySource.get(source);
            // Process patterns in reverse order
            for (let i = sourcePatterns.length - 1; i >= 0; i--) {
                const { pattern, isNegation } = sourcePatterns[i];
                if ((0, minimatch_1.minimatch)(normalizedPath, pattern, { dot: true })) {
                    if (isNegation) {
                        hasMatchingNegation = true;
                    }
                    else if (!hasMatchingNegation) {
                        shouldBeIgnored = true;
                    }
                }
            }
        }
        return shouldBeIgnored && !hasMatchingNegation;
    }
    clear() {
        this.patterns = [];
    }
}
exports.PatternMatcher = PatternMatcher;
//# sourceMappingURL=PatternMatcher.js.map