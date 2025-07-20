# Telemetry & Observability

@hanzo/ai includes comprehensive telemetry and observability features that integrate seamlessly with Hanzo Cloud's monitoring platform.

## Overview

The telemetry system provides:
- Distributed tracing with OpenTelemetry
- Structured logging with Winston
- Metrics collection (counters, gauges, histograms)
- Session tracking
- Error tracking and reporting
- Performance monitoring

## Basic Usage

### Local Telemetry

```typescript
import { createAgent, Telemetry } from '@hanzo/ai';

// Create a basic telemetry instance
const telemetry = new Telemetry({
  serviceName: 'my-ai-service',
  enabled: true
});

// Use with agents
const agent = createAgent({
  name: 'my-agent',
  // ... other config
});

const result = await agent.run({
  messages: [{ role: 'user', content: 'Hello' }],
  context: { telemetry }
});
```

### Hanzo Cloud Integration

```typescript
import { createHanzoCloudTelemetry } from '@hanzo/ai/telemetry/hanzo-cloud';

// Initialize Hanzo Cloud telemetry
const telemetry = createHanzoCloudTelemetry({
  cloudUrl: 'https://cloud.hanzo.ai',
  apiKey: process.env.HANZO_CLOUD_API_KEY!,
  projectId: process.env.HANZO_PROJECT_ID!,
  environment: 'production',
  serviceName: 'customer-support-ai',
  serviceVersion: '1.0.0'
});
```

## Features

### Distributed Tracing

Track execution flow across agents and networks:

```typescript
// Trace a custom operation
const result = await telemetry.trace(
  'process_order',
  async (span) => {
    span.setAttributes({
      'order.id': orderId,
      'order.amount': amount
    });
    
    // Your logic here
    return processOrder(orderId);
  },
  {
    kind: SpanKind.CLIENT,
    attributes: {
      'service.operation': 'order_processing'
    }
  }
);
```

### Structured Logging

Log with automatic trace context:

```typescript
telemetry.log('info', 'Processing customer request', {
  customerId: '12345',
  requestType: 'support'
});

telemetry.log('error', 'Failed to process request', {
  error: error.message,
  stack: error.stack
});
```

### Metrics Collection

Track key performance indicators:

```typescript
// Counters
telemetry.increment('api.requests', 1, {
  endpoint: '/chat',
  method: 'POST'
});

// Gauges
telemetry.gauge('queue.size', queueLength, {
  queue: 'processing'
});

// Histograms
telemetry.histogram('response.time', responseTime, {
  endpoint: '/chat'
});
```

### Agent & Network Metrics

Automatic metrics for agent executions:

- `agent.executions` - Count of agent runs
- `agent.execution.duration` - Agent execution time
- `agent.tokens.used` - Token usage per agent
- `tool.executions` - Tool usage statistics
- `network.iterations` - Network iteration count
- `network.execution.duration` - Total network execution time

### Session Tracking

Track related executions:

```typescript
// Create a session
const sessionId = telemetry.createSession();

// All subsequent operations will be linked to this session
const result = await network.run({
  messages: [...],
  telemetry
});
```

### Error Tracking

Automatic error capture with context:

```typescript
try {
  await agent.run({ messages, telemetry });
} catch (error) {
  // Errors are automatically recorded with span context
  telemetry.recordException(error);
}
```

## Network Telemetry

Networks provide additional telemetry:

```typescript
const network = createNetwork({
  name: 'support_network',
  agents: [classifier, techSupport, billing],
  // ...
});

// Automatic tracking of:
// - Router decisions
// - Agent handoffs
// - State changes
// - Iteration count
// - Total execution time

const result = await network.run({
  messages: [...],
  telemetry
});
```

## MCP Server Telemetry

Track MCP server connections:

```typescript
// Automatic tracking when MCP servers are connected
const agent = createAgent({
  name: 'mcp-agent',
  mcpServers: [{
    name: 'file-system',
    transport: { type: 'stdio', command: 'mcp-fs' }
  }]
});

// Metrics tracked:
// - mcp.connections
// - mcp.servers.active
// - mcp.tool.calls
```

## Best Practices

### 1. Use Structured Attributes

```typescript
span.setAttributes({
  'user.id': userId,
  'user.tier': 'premium',
  'request.type': 'chat',
  'request.model': 'gpt-4'
});
```

### 2. Create Meaningful Spans

```typescript
await telemetry.trace('user_request', async () => {
  await telemetry.trace('validate_input', validateInput);
  await telemetry.trace('process_with_ai', processAI);
  await telemetry.trace('format_response', formatResponse);
});
```

### 3. Track Business Metrics

```typescript
// Track business-relevant metrics
telemetry.increment('revenue.processed', amount, {
  currency: 'USD',
  paymentMethod: 'stripe'
});

telemetry.gauge('customer.satisfaction', score, {
  surveyType: 'nps'
});
```

### 4. Use Session Context

```typescript
// Link related operations
const sessionId = telemetry.createSession();

for (const message of conversation) {
  await handleMessage(message, telemetry);
}
```

### 5. Proper Cleanup

```typescript
// Always flush telemetry before shutdown
process.on('SIGTERM', async () => {
  await telemetry.shutdown();
  process.exit(0);
});
```

## Viewing Telemetry Data

### Hanzo Cloud Console

Access your telemetry data at:
- Traces: `https://cloud.hanzo.ai/projects/{projectId}/traces`
- Metrics: `https://cloud.hanzo.ai/projects/{projectId}/metrics`
- Logs: `https://cloud.hanzo.ai/projects/{projectId}/logs`

### Local Development

In development, telemetry outputs to console with structured JSON:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "message": "Agent executed",
  "trace_id": "abc123",
  "span_id": "def456",
  "agent": "classifier",
  "duration": 245,
  "success": true
}
```

## Performance Impact

The telemetry system is designed for minimal overhead:
- Async span processing
- Batched metric collection
- Configurable sampling
- Automatic span pruning
- Efficient memory usage

Disable in performance-critical paths:

```typescript
const telemetry = new Telemetry({
  enabled: process.env.NODE_ENV === 'production'
});
```

## Troubleshooting

### Missing Traces

Check:
1. Telemetry is enabled
2. API key is valid
3. Network connectivity to Hanzo Cloud
4. Proper span nesting

### High Memory Usage

- Reduce span attributes
- Enable sampling
- Decrease batch size
- Check for span leaks

### Debug Mode

Enable debug logging:

```typescript
const telemetry = createHanzoCloudTelemetry({
  // ...
  logLevel: 'debug'
});
```

## Advanced Features

### Custom Span Processors

```typescript
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Add custom processing
const processor = new BatchSpanProcessor(customExporter);
telemetry.addSpanProcessor(processor);
```

### Context Propagation

```typescript
// Get trace context for external services
const headers = telemetry.getTraceContext();

// Make external request with trace context
await fetch(url, {
  headers: {
    ...headers,
    'Content-Type': 'application/json'
  }
});
```

### Multi-Region Support

```typescript
const telemetry = createHanzoCloudTelemetry({
  cloudUrl: process.env.HANZO_CLOUD_URL || 'https://cloud.hanzo.ai',
  // Auto-detected from environment
  region: process.env.HANZO_CLOUD_REGION
});
```