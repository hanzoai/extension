# GitHub Actions Workflow Status

## Build Status

| Extension | Build | Tests | Release |
|-----------|-------|-------|---------|
| VS Code | [![VS Code Extension CI/CD](https://github.com/hanzoai/extension/workflows/VS%20Code%20Extension%20CI%2FCD/badge.svg)](https://github.com/hanzoai/extension/actions/workflows/vscode-extension.yml) | ✅ | Auto |
| JetBrains | [![JetBrains Plugin CI/CD](https://github.com/hanzoai/extension/workflows/JetBrains%20Plugin%20CI%2FCD/badge.svg)](https://github.com/hanzoai/extension/actions/workflows/jetbrains-plugin.yml) | ✅ | Auto |
| Claude Code | Included in VS Code workflow | ✅ | Auto |

## Recent Workflow Runs

The workflows are configured to:

1. **On Push to Main**:
   - Run tests for modified extensions
   - Build artifacts
   - Create pre-release with artifacts

2. **On Pull Request**:
   - Run tests only
   - Verify build succeeds

3. **On Version Tag** (v*):
   - Build all extensions
   - Create official release
   - Upload all artifacts

## Test Coverage

### VS Code Extension
- Extension activation tests
- Command registration tests
- Configuration management tests
- MCP functionality tests
- Simple integration tests

### JetBrains Plugin
- Plugin initialization tests
- Authentication service tests
- Project service tests
- Settings management tests
- API integration tests

## Debugging Failed Workflows

### Common Issues

1. **TypeScript Compilation Errors**
   - Check `npm run compile` locally
   - Review type definitions
   - Update dependencies if needed

2. **Gradle Build Failures**
   - Verify Gradle wrapper is committed
   - Check Java version (requires 17)
   - Review dependency conflicts

3. **Test Failures**
   - Run tests locally first
   - Check for environment-specific issues
   - Mock external dependencies

### Local Testing

```bash
# VS Code Extension
npm install
npm run compile
npm run test:simple

# JetBrains Plugin
cd jetbrains-plugin
./gradlew test
./gradlew build
```

## Monitoring

- Check [Actions tab](https://github.com/hanzoai/extension/actions) for real-time status
- Review workflow logs for detailed error messages
- Enable notifications for workflow failures