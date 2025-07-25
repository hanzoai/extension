"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_IGNORED_PATTERNS = void 0;
exports.DEFAULT_IGNORED_PATTERNS = [
    'SPEC.md',
    '.cursorrules',
    'copilot-instructions.md',
    '.continuerules',
    // Common directories to ignore
    'node_modules',
    '**/node_modules/**',
    '.git',
    'dist',
    '.vscode',
    '.idea',
    '**/dist/**',
    '**/.git/**',
    '**/build/**',
    '**/out/**',
    '**/coverage/**',
    '**/tmp/**',
    '**/temp/**',
    // Common files to ignore
    '**/*.log',
    '**/.DS_Store',
    '**/.env*',
    '**/.gitignore',
    '**/.hanzoignore',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/npm-debug.log*',
    '**/yarn-debug.log*',
    '**/yarn-error.log*',
    // Common test and build artifacts
    '**/*.min.js',
    '**/*.map',
    '**/__tests__/**',
    '**/__mocks__/**',
    '**/*.test.*',
    '**/*.spec.*',
    // Common large binary files
    '**/*.zip',
    '**/*.tar',
    '**/*.gz',
    '**/*.rar',
    '**/*.7z',
    '**/*.pdf',
    '**/*.jpg',
    '**/*.jpeg',
    '**/*.png',
    '**/*.gif',
    '**/*.ico',
    '**/*.svg',
    '**/*.woff',
    '**/*.woff2',
    '**/*.ttf',
    '**/*.eot'
];
//# sourceMappingURL=ignored-patterns.js.map