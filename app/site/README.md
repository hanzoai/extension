# Hanzo.app - AI Development Platform Gateway

Central hub for downloading and accessing Hanzo AI across all platforms.

## 🚀 Quick Start

```bash
# Install dependencies (using pnpm)
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## 📦 Build Output

When you run `pnpm build`, the static files are generated in the `dist` directory:

```
dist/
├── index.html      # Main landing page
└── src/
    └── dev.html    # Dev CLI landing page
```

## 📱 Available Platforms

- **Desktop Apps**: Windows, macOS, Linux
- **Mobile Apps**: iOS, Android
- **Browser Extensions**: Chrome, Firefox, Edge, Safari
- **IDE Extensions**: VS Code, JetBrains
- **CLI Tools**: Dev CLI (`@hanzo/dev`), MCP Server (`@hanzo/mcp`)
- **Cloud Platform**: cloud.hanzo.ai

## 🛠️ Development

### Prerequisites
- Node.js 18+
- pnpm (install with `npm install -g pnpm`)

### Available Scripts

```bash
pnpm dev          # Start dev server on port 3000
pnpm build        # Build static site to dist/
pnpm preview      # Preview built site on port 3001
pnpm clean        # Clean dist directory
pnpm clean:all    # Clean everything (dist, node_modules, lock file)
pnpm test         # Run Playwright tests
pnpm test:ui      # Run tests with UI
```

### Testing
```bash
# Install Playwright browsers (first time only)
pnpm exec playwright install chromium

# Run tests
pnpm test
```

### Deployment

The site can be deployed to any static hosting service. The `dist` directory contains all the files needed.

#### Vercel
```bash
pnpm build
vercel --prod ./dist
```

#### Netlify
```bash
pnpm build
netlify deploy --dir=dist --prod
```

#### GitHub Pages
```bash
pnpm build
# Push dist directory to gh-pages branch
```

## 📄 Pages

- `/` - Main download hub for all Hanzo products
- `/src/dev.html` - Dev CLI specific landing page

## 🎨 Design

- Monochromatic black and white theme
- Hanzo logo integrated in header
- Responsive grid layout
- Smooth animations on scroll

## 🔗 Links

- [Hanzo AI](https://hanzo.ai)
- [Documentation](https://docs.hanzo.ai)
- [GitHub](https://github.com/hanzoai)
- [Discord](https://discord.gg/hanzoai)