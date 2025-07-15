# Hanzo AI Modes: Unlock Unlimited Potential

Hanzo AI is the unified platform for building AI-powered companies, offering legendary programmer modes, unlimited memory, expanded context, and advanced search capabilities across all your projects.

## 🧠 Legendary Programmer Modes

Unlock the expertise of computing legends with specialized modes that configure tools, workflows, and philosophies:

### Pioneers & Legends
- **ritchie**: Dennis Ritchie - UNIX philosophy, systems programming
- **kernighan**: Brian Kernighan - Clear code, documentation mastery  
- **thompson**: Ken Thompson - Elegant algorithms, minimal design
- **pike**: Rob Pike - Concurrency, simplicity, Go philosophy
- **stroustrup**: Bjarne Stroustrup - C++ design, object-oriented excellence

### Language Masters
- **matz**: Yukihiro Matsumoto - Ruby creator, developer happiness
- **dhh**: David Heinemeier Hansson - Rails philosophy, convention over configuration
- **gosling**: James Gosling - Java creator, enterprise architecture
- **rich**: Rich Harris - Modern web, Svelte innovation
- **wirth**: Niklaus Wirth - Pascal creator, structured programming

### AI & Machine Learning
- **bengio**: Yoshua Bengio - Deep learning pioneer
- **lecun**: Yann LeCun - Computer vision, CNN architecture
- **norvig**: Peter Norvig - AI algorithms, practical implementation
- **ng**: Andrew Ng - ML education, practical AI deployment

### Systems & Infrastructure
- **carmack**: John Carmack - Game engines, performance optimization
- **torvalds**: Linus Torvalds - Linux kernel, distributed development
- **tanenbaum**: Andrew Tanenbaum - Operating systems, distributed computing
- **bernstein**: Daniel J. Bernstein - Security, cryptography, qmail

### Web & Frontend Masters
- **resig**: John Resig - jQuery creator, JavaScript mastery
- **dahl**: Ryan Dahl - Node.js/Deno creator, async programming
- **eich**: Brendan Eich - JavaScript creator, language design
- **crockford**: Douglas Crockford - JavaScript: The Good Parts

### Database & Data
- **gray**: Jim Gray - Transaction processing, database systems
- **hellerstein**: Joseph Hellerstein - Query optimization, data systems
- **stonebraker**: Michael Stonebraker - PostgreSQL, database architecture

### Security & Cryptography
- **rivest**: Ron Rivest - RSA encryption, security algorithms
- **schneier**: Bruce Schneier - Applied cryptography, security thinking
- **bernstein**: Daniel J. Bernstein - qmail, djbdns, curve25519

### Full List of 45+ Modes
```bash
# Activate any mode
@hanzo mode carmack  # Game engine optimization
@hanzo mode pike     # Go concurrency patterns
@hanzo mode norvig   # AI algorithm implementation
```

## 🚀 Unlimited Memory & Context

### Vector + Graph + Relational Search
Hanzo AI combines multiple search paradigms for comprehensive code understanding:

```bash
# Symbolic search across all projects
@hanzo search "class AuthProvider implements"

# Relational queries
@hanzo search "functions that call validateUser()"

# Graph-based navigation  
@hanzo search "all dependencies of PaymentService"

# Vector semantic search
@hanzo search "code similar to rate limiting logic"

# Full-text search with regex
@hanzo search "/async.*fetch.*json/i"
```

### Expanded Context Window
- **Unlimited project memory**: Never lose context between sessions
- **Cross-project intelligence**: Learn from all your repositories
- **Persistent workspace state**: Resume exactly where you left off
- **Shared team knowledge**: Collaborate with shared context

## 📊 Unified Dashboard

Manage everything from one powerful interface:

### Project Management
- **Multi-repo overview**: See all projects at a glance
- **Dependency tracking**: Visualize project relationships
- **Change monitoring**: Track modifications across repositories
- **Team collaboration**: Share context and insights

### AI Model Management  
- **200+ LLMs**: Access every model through one API
- **Usage analytics**: Track costs and performance
- **Smart routing**: Automatic model selection
- **Credit management**: Monitor and control spending

### Deployment & DevOps
- **One-click deployment**: Deploy any open source app
- **Container management**: Docker and Kubernetes integration
- **CI/CD pipelines**: Automated testing and deployment
- **Monitoring**: Real-time performance tracking

## 🛠️ IDE Integration via MCP

### Terminal Integration
```bash
# Configure for iTerm2
@hanzo configure --ide iterm2

# Native async support
@hanzo terminal --async execute "npm test"
```

### Neovim/Vim Integration
```vim
" Add to your init.vim
Plug 'hanzoai/vim-mcp'

" Use Hanzo AI in vim
:Hanzo analyze current function
:Hanzo refactor selection
:Hanzo explain
```

### Browser Control
```bash
# Enable browser automation
@hanzo browser enable

# Launches Chrome with Playwright
@hanzo browser navigate "https://docs.hanzo.ai"
@hanzo browser screenshot
@hanzo browser extract "CSS selector"
```

The browser tool automatically:
- Installs Playwright MCP server
- Manages Chrome/Chromium instances
- Provides high-level browser control
- Enables web scraping and testing

## 💎 Premium Features

### Supercharge Your AI Development
Subscribe to unlock:

- **Priority access**: Latest models (O3-Pro, Claude 4, GPT-4o)
- **Higher limits**: 10x more requests per minute
- **Team features**: Shared credits and context
- **Advanced search**: Graph-based code intelligence
- **Custom models**: Fine-tuned models for your codebase
- **Dedicated support**: Direct access to Hanzo team

### Pricing Tiers
- **Starter**: $19/month - 100K credits
- **Pro**: $99/month - 1M credits + team features  
- **Enterprise**: Custom - Unlimited usage + SLA

## 🏗️ Building AI-Powered Companies

Hanzo AI provides the complete toolkit for AI-driven development:

### Integrated Development
```bash
# Create new AI project
@hanzo create ai-startup --template saas

# Add AI capabilities
@hanzo add llm-integration
@hanzo add vector-search
@hanzo add agent-framework

# Deploy instantly
@hanzo deploy --platform vercel
```

### Pre-built Templates
- **SaaS Starter**: Multi-tenant AI application
- **Agent Platform**: Multi-agent orchestration
- **API Gateway**: LLM proxy with auth
- **Chat Interface**: Production chat UI
- **Analytics Dashboard**: Usage tracking

### Enterprise Features
- **SSO Integration**: SAML, OAuth, LDAP
- **Compliance**: SOC2, HIPAA ready
- **White-labeling**: Custom branding
- **Private deployment**: On-premise options

## 🔧 Configuration

### .hanzo/config.yaml
```yaml
# IDE Configuration
ide:
  primary: vscode
  terminal: iterm2
  editor: neovim

# MCP Servers
mcp:
  browser:
    enabled: true
    defaultBrowser: chrome
    headless: false
  
  search:
    providers:
      - vector
      - graph
      - relational
      - fulltext
  
  memory:
    unlimited: true
    persistence: cloud

# AI Configuration  
ai:
  defaultModel: claude-4
  fallbackModels:
    - gpt-4o
    - gemini-2.0-flash
  
  routing:
    simple: gpt-3.5-turbo
    complex: o3-pro
    creative: claude-4
    analytical: deepseek-v3

# Team Settings
team:
  sharedContext: true
  creditPool: true
  knowledgeBase: true
```

## 🎯 Getting Started

1. **Install Extension**
   ```bash
   # VS Code/Cursor/Windsurf
   Install hanzoai-*.vsix
   
   # Claude Code  
   Drag hanzoai-*.dxt
   
   # Terminal/Neovim
   npx @hanzo/mcp@latest
   ```

2. **Configure Environment**
   ```bash
   # Set up Hanzo AI
   export HANZO_API_KEY=hzo_...
   
   # Configure IDE
   @hanzo configure --ide vscode
   
   # Enable browser control
   @hanzo browser enable
   ```

3. **Choose Your Mode**
   ```bash
   # Activate a legendary programmer mode
   @hanzo mode carmack  # Performance optimization
   @hanzo mode norvig   # AI implementation
   @hanzo mode pike     # Clean, concurrent code
   ```

4. **Start Building**
   ```bash
   # Create AI-powered app
   @hanzo create my-ai-startup
   
   # Use unlimited memory
   @hanzo remember "Project uses NextJS 14 with App Router"
   
   # Search across everything
   @hanzo search "authentication flow"
   ```

## 🌟 Why Hanzo AI?

**For Individual Developers**
- Access 200+ AI models with one API key
- Legendary programmer modes for expert guidance
- Unlimited memory and context
- Advanced search across all projects

**For Teams**
- Shared context and knowledge base
- Unified billing and credit management
- Collaborative AI development
- Enterprise security and compliance

**For Companies**
- Complete platform for AI-powered products
- Pre-built templates and frameworks
- Instant deployment and scaling
- White-label and customization options

---

**Ready to supercharge your AI development?**

🚀 [Sign up at iam.hanzo.ai](https://iam.hanzo.ai) to get started

💬 Join our community: [discord.gg/hanzoai](https://discord.gg/hanzoai)

📚 Documentation: [docs.hanzo.ai](https://docs.hanzo.ai)