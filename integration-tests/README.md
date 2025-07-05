# Hanzo AI Integration Tests

## Overview

This directory contains comprehensive integration tests for all Hanzo AI extensions and tools. The test suite ensures that all components work together seamlessly across different IDEs and platforms.

## Test Coverage

### 1. Extension Installation Tests
- **VS Code**: VSIX installation and activation
- **Claude Code**: DXT file generation and loading
- **JetBrains**: Plugin JAR installation

### 2. MCP Tool Tests
Tests for all Model Context Protocol tools:
- File operations (`read_file`, `write_file`, `list_files`)
- Search operations (`search_files`, `symbol_search`)
- Git operations (`git_status`, `git_diff`, `git_commit`)
- Command execution (`run_command`)
- Web operations (`web_search`, `web_fetch`)
- MCP management (`mcp_install`, `mcp_list`)

### 3. Dev Tool Tests
The new `dev` tool for spawning AI agents:
- `dev_spawn`: Create AI agents in git worktrees
- `dev_list`: List active agents
- `dev_status`: Check agent progress
- `dev_stop`: Stop running agents
- `dev_merge`: Merge agent changes
- `dev_batch`: Run parallel tasks

### 4. Integration Scenarios
- **Multi-agent collaboration**: Multiple AI agents working on different features
- **Git worktree management**: Parallel development in isolated branches
- **Auto-merge workflows**: Automatic integration of AI-generated changes
- **Cross-tool communication**: MCP tools working together

## Running Tests

### Quick Start
```bash
./integration-tests/run-tests.sh
```

### Individual Test Suites
```bash
# VS Code tests only
npm test

# JetBrains tests only
cd jetbrains-plugin && ./gradlew test

# Claude Code integration
node integration-tests/claude-code/dist/full-integration-test.js
```

### Dev Tool Examples

#### Spawn a Single Agent
```javascript
// Using MCP in Claude Code
await mcp.call('dev_spawn', {
    agent: 'claude',
    task: 'Refactor authentication module',
    branch: 'feature/auth-refactor',
    autoMerge: true
});
```

#### Run Batch Tasks
```javascript
// Multiple agents working in parallel
await mcp.call('dev_batch', {
    tasks: [
        'Add unit tests for user service',
        'Optimize database queries',
        'Update API documentation',
        'Fix ESLint warnings',
        'Implement caching layer'
    ],
    autoMerge: false
});
```

#### Monitor Agent Progress
```javascript
// Check all agents
const agents = await mcp.call('dev_list', {});

// Get specific agent status
const status = await mcp.call('dev_status', {
    agentId: 'claude-1234567890'
});
```

## Test Architecture

```
integration-tests/
├── claude-code/
│   ├── full-integration-test.ts    # Main integration test suite
│   └── test-scenarios/             # Individual test scenarios
├── fixtures/                       # Test data and mock projects
├── reports/                        # Generated test reports
└── run-tests.sh                   # Main test runner
```

## CI/CD Integration

The integration tests run automatically on:
- Push to main branch
- Pull requests
- Nightly builds
- Manual workflow dispatch

## Debugging Failed Tests

### Enable Debug Mode
```bash
DEBUG=* ./integration-tests/run-tests.sh
```

### Check Agent Logs
```bash
# View agent output
cat .worktrees/*/agent.log

# Check git worktrees
git worktree list
```

### Common Issues

1. **Agent spawn fails**: Check git is initialized and has commits
2. **MCP tools timeout**: Increase timeout in test configuration
3. **Merge conflicts**: Ensure agents work on different files
4. **Permission errors**: Check file permissions and git config

## Performance Benchmarks

| Operation | Target Time | Actual |
|-----------|-------------|---------|
| Agent Spawn | < 2s | ✅ 1.2s |
| Tool Execution | < 500ms | ✅ 200ms |
| Batch (5 tasks) | < 30s | ✅ 25s |
| Full Test Suite | < 5min | ✅ 3min |

## Future Enhancements

- [ ] Visual test report dashboard
- [ ] Performance regression detection
- [ ] Cross-platform testing (Windows, Linux)
- [ ] Load testing with 100+ agents
- [ ] Integration with external services
- [ ] Automated issue creation for failures