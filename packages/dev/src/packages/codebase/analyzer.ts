/**
 * Codebase Analyzer
 * Comprehensive codebase analysis and understanding
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';
import { ASTParser } from './ast';
import { SymbolIndex } from './symbols';
import { DependencyGraph } from './dependencies';
import { CodebaseMetrics } from './metrics';

export interface CodebaseInfo {
  rootPath: string;
  name: string;
  type: 'monorepo' | 'library' | 'application' | 'unknown';
  languages: LanguageStats[];
  frameworks: Framework[];
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'cargo' | 'go';
  testFramework?: string;
  buildTool?: string;
  files: number;
  lines: number;
  size: number;
}

export interface LanguageStats {
  language: string;
  files: number;
  lines: number;
  bytes: number;
  percentage: number;
}

export interface Framework {
  name: string;
  version?: string;
  type: 'backend' | 'frontend' | 'fullstack' | 'testing' | 'build';
}

export interface AnalysisOptions {
  includeTests?: boolean;
  includeVendor?: boolean;
  maxDepth?: number;
  patterns?: string[];
  ignore?: string[];
}

export class CodebaseAnalyzer extends EventEmitter {
  private ast: ASTParser;
  private symbols: SymbolIndex;
  private dependencies: DependencyGraph;
  private metrics: CodebaseMetrics;
  
  constructor() {
    super();
    this.ast = new ASTParser();
    this.symbols = new SymbolIndex();
    this.dependencies = new DependencyGraph();
    this.metrics = new CodebaseMetrics();
  }
  
  async analyze(rootPath: string, options: AnalysisOptions = {}): Promise<CodebaseInfo> {
    this.emit('analysis:start', { rootPath });
    
    const info: CodebaseInfo = {
      rootPath,
      name: path.basename(rootPath),
      type: 'unknown',
      languages: [],
      frameworks: [],
      files: 0,
      lines: 0,
      size: 0
    };
    
    // Detect project type
    info.type = await this.detectProjectType(rootPath);
    info.packageManager = await this.detectPackageManager(rootPath);
    
    // Analyze files
    const files = await this.scanFiles(rootPath, options);
    info.files = files.length;
    
    // Language statistics
    info.languages = await this.analyzeLanguages(files);
    
    // Framework detection
    info.frameworks = await this.detectFrameworks(rootPath, files);
    
    // Build symbol index
    await this.buildSymbolIndex(files);
    
    // Build dependency graph
    await this.buildDependencyGraph(files);
    
    // Calculate metrics
    const metrics = await this.metrics.calculate(files);
    info.lines = metrics.totalLines;
    info.size = metrics.totalBytes;
    
    this.emit('analysis:complete', info);
    
    return info;
  }
  
  private async detectProjectType(rootPath: string): Promise<CodebaseInfo['type']> {
    // Check for monorepo indicators
    if (fs.existsSync(path.join(rootPath, 'lerna.json')) ||
        fs.existsSync(path.join(rootPath, 'pnpm-workspace.yaml')) ||
        fs.existsSync(path.join(rootPath, 'rush.json'))) {
      return 'monorepo';
    }
    
    // Check for library indicators
    if (fs.existsSync(path.join(rootPath, 'src/index.ts')) ||
        fs.existsSync(path.join(rootPath, 'src/index.js')) ||
        fs.existsSync(path.join(rootPath, 'lib/index.js'))) {
      return 'library';
    }
    
    // Check for application indicators
    if (fs.existsSync(path.join(rootPath, 'src/main.ts')) ||
        fs.existsSync(path.join(rootPath, 'src/App.tsx')) ||
        fs.existsSync(path.join(rootPath, 'pages')) ||
        fs.existsSync(path.join(rootPath, 'app'))) {
      return 'application';
    }
    
    return 'unknown';
  }
  
  private async detectPackageManager(rootPath: string): Promise<CodebaseInfo['packageManager'] | undefined> {
    if (fs.existsSync(path.join(rootPath, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(rootPath, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(rootPath, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(rootPath, 'bun.lockb'))) return 'bun';
    if (fs.existsSync(path.join(rootPath, 'Pipfile.lock'))) return 'pip';
    if (fs.existsSync(path.join(rootPath, 'Cargo.lock'))) return 'cargo';
    if (fs.existsSync(path.join(rootPath, 'go.sum'))) return 'go';
    return undefined;
  }
  
  private async scanFiles(rootPath: string, options: AnalysisOptions): Promise<string[]> {
    const defaultIgnore = [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/*.map'
    ];
    
    const ignore = [...defaultIgnore, ...(options.ignore || [])];
    
    if (!options.includeTests) {
      ignore.push('**/__tests__/**', '**/test/**', '**/*.test.*', '**/*.spec.*');
    }
    
    if (!options.includeVendor) {
      ignore.push('**/vendor/**', '**/third_party/**');
    }
    
    const patterns = options.patterns || [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.java', '**/*.go', '**/*.rs',
      '**/*.rb', '**/*.php', '**/*.c', '**/*.cpp',
      '**/*.h', '**/*.hpp', '**/*.cs', '**/*.swift'
    ];
    
    const files: string[] = [];
    
    for (const pattern of patterns) {
      const matches = globSync(pattern, {
        cwd: rootPath,
        ignore,
        absolute: true
      });
      files.push(...matches);
    }
    
    return [...new Set(files)]; // Remove duplicates
  }
  
  private async analyzeLanguages(files: string[]): Promise<LanguageStats[]> {
    const stats: Map<string, LanguageStats> = new Map();
    let totalBytes = 0;
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      const language = this.getLanguageFromExtension(ext);
      
      if (!language) continue;
      
      const content = await fs.promises.readFile(file, 'utf-8');
      const lines = content.split('\n').length;
      const bytes = Buffer.byteLength(content);
      
      totalBytes += bytes;
      
      if (!stats.has(language)) {
        stats.set(language, {
          language,
          files: 0,
          lines: 0,
          bytes: 0,
          percentage: 0
        });
      }
      
      const stat = stats.get(language)!;
      stat.files++;
      stat.lines += lines;
      stat.bytes += bytes;
    }
    
    // Calculate percentages
    const results = Array.from(stats.values());
    results.forEach(stat => {
      stat.percentage = (stat.bytes / totalBytes) * 100;
    });
    
    // Sort by bytes descending
    return results.sort((a, b) => b.bytes - a.bytes);
  }
  
  private getLanguageFromExtension(ext: string): string | null {
    const languageMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.c': 'C',
      '.cpp': 'C++',
      '.cc': 'C++',
      '.h': 'C/C++',
      '.hpp': 'C++',
      '.cs': 'C#',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.scala': 'Scala',
      '.r': 'R',
      '.jl': 'Julia',
      '.dart': 'Dart',
      '.lua': 'Lua',
      '.pl': 'Perl',
      '.sh': 'Shell',
      '.sql': 'SQL'
    };
    
    return languageMap[ext] || null;
  }
  
  private async detectFrameworks(rootPath: string, files: string[]): Promise<Framework[]> {
    const frameworks: Framework[] = [];
    
    // Check package.json for JS/TS frameworks
    const packageJsonPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'));
      
      // Frontend frameworks
      if (pkg.dependencies?.react || pkg.devDependencies?.react) {
        frameworks.push({
          name: 'React',
          version: pkg.dependencies?.react || pkg.devDependencies?.react,
          type: 'frontend'
        });
      }
      
      if (pkg.dependencies?.vue || pkg.devDependencies?.vue) {
        frameworks.push({
          name: 'Vue',
          version: pkg.dependencies?.vue || pkg.devDependencies?.vue,
          type: 'frontend'
        });
      }
      
      if (pkg.dependencies?.['@angular/core']) {
        frameworks.push({
          name: 'Angular',
          version: pkg.dependencies['@angular/core'],
          type: 'frontend'
        });
      }
      
      // Backend frameworks
      if (pkg.dependencies?.express) {
        frameworks.push({
          name: 'Express',
          version: pkg.dependencies.express,
          type: 'backend'
        });
      }
      
      if (pkg.dependencies?.fastify) {
        frameworks.push({
          name: 'Fastify',
          version: pkg.dependencies.fastify,
          type: 'backend'
        });
      }
      
      if (pkg.dependencies?.next) {
        frameworks.push({
          name: 'Next.js',
          version: pkg.dependencies.next,
          type: 'fullstack'
        });
      }
      
      // Test frameworks
      if (pkg.devDependencies?.jest) {
        frameworks.push({
          name: 'Jest',
          version: pkg.devDependencies.jest,
          type: 'testing'
        });
      }
      
      if (pkg.devDependencies?.vitest) {
        frameworks.push({
          name: 'Vitest',
          version: pkg.devDependencies.vitest,
          type: 'testing'
        });
      }
    }
    
    // Check for Python frameworks
    const requirementsPath = path.join(rootPath, 'requirements.txt');
    if (fs.existsSync(requirementsPath)) {
      const requirements = await fs.promises.readFile(requirementsPath, 'utf-8');
      
      if (requirements.includes('django')) {
        frameworks.push({ name: 'Django', type: 'fullstack' });
      }
      
      if (requirements.includes('flask')) {
        frameworks.push({ name: 'Flask', type: 'backend' });
      }
      
      if (requirements.includes('fastapi')) {
        frameworks.push({ name: 'FastAPI', type: 'backend' });
      }
    }
    
    // Check for Rails
    if (fs.existsSync(path.join(rootPath, 'Gemfile'))) {
      const gemfile = await fs.promises.readFile(path.join(rootPath, 'Gemfile'), 'utf-8');
      if (gemfile.includes('rails')) {
        frameworks.push({ name: 'Ruby on Rails', type: 'fullstack' });
      }
    }
    
    return frameworks;
  }
  
  private async buildSymbolIndex(files: string[]): Promise<void> {
    this.emit('indexing:start', { files: files.length });
    
    for (const file of files) {
      try {
        const symbols = await this.ast.extractSymbols(file);
        this.symbols.addFile(file, symbols);
      } catch (error) {
        this.emit('indexing:error', { file, error });
      }
    }
    
    this.emit('indexing:complete', { 
      symbols: this.symbols.getSymbolCount() 
    });
  }
  
  private async buildDependencyGraph(files: string[]): Promise<void> {
    this.emit('graph:start', { files: files.length });
    
    for (const file of files) {
      try {
        const deps = await this.ast.extractDependencies(file);
        this.dependencies.addFile(file, deps);
      } catch (error) {
        this.emit('graph:error', { file, error });
      }
    }
    
    this.emit('graph:complete', { 
      nodes: this.dependencies.getNodeCount(),
      edges: this.dependencies.getEdgeCount()
    });
  }
  
  // Query methods
  findSymbol(name: string, type?: string): any[] {
    return this.symbols.find(name, type);
  }
  
  findReferences(symbolName: string): string[] {
    return this.symbols.findReferences(symbolName);
  }
  
  getDependencies(file: string): string[] {
    return this.dependencies.getDependencies(file);
  }
  
  getDependents(file: string): string[] {
    return this.dependencies.getDependents(file);
  }
  
  getMetrics(): any {
    return this.metrics.getAll();
  }
}

// Global instance
export const codebaseAnalyzer = new CodebaseAnalyzer();