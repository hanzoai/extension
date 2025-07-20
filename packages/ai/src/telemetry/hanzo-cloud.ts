/**
 * Hanzo Cloud telemetry integration
 * Connects to Hanzo Cloud's observability platform for centralized monitoring
 */

import { Telemetry, TelemetryConfig } from './index';
import * as opentelemetry from '@opentelemetry/api';
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import winston from 'winston';

export interface HanzoCloudConfig extends TelemetryConfig {
  cloudUrl: string;
  apiKey: string;
  projectId: string;
  environment?: string;
  serviceName?: string;
  serviceVersion?: string;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export class HanzoCloudTelemetry extends Telemetry {
  private logger: winston.Logger;
  private exporter?: OTLPTraceExporter;
  private provider?: NodeTracerProvider;
  private metricsBuffer: Map<string, any[]> = new Map();
  private flushInterval?: NodeJS.Timeout;
  
  constructor(config: HanzoCloudConfig) {
    super(config);
    
    // Setup Winston logger with Hanzo Cloud format
    this.logger = this.createLogger(config);
    
    // Initialize OpenTelemetry
    this.initializeOpenTelemetry(config);
    
    // Start metrics flush interval
    this.startMetricsFlush(config);
    
    // Log initialization
    this.logger.info('Hanzo Cloud telemetry initialized', {
      projectId: config.projectId,
      environment: config.environment || 'development',
      serviceName: config.serviceName || 'hanzo-ai'
    });
  }
  
  private createLogger(config: HanzoCloudConfig): winston.Logger {
    // Tracing format that adds trace context to logs
    const tracingFormat = winston.format((info) => {
      const span = opentelemetry.trace.getActiveSpan();
      if (span) {
        const { spanId, traceId } = span.spanContext();
        info['trace_id'] = traceId;
        info['span_id'] = spanId;
        info['project_id'] = config.projectId;
        info['service.name'] = config.serviceName || 'hanzo-ai';
      }
      return info;
    });
    
    return winston.createLogger({
      level: config.logLevel || 'info',
      format: winston.format.combine(
        winston.format.errors({ stack: true }),
        winston.format.timestamp(),
        tracingFormat(),
        winston.format.json()
      ),
      defaultMeta: {
        service: config.serviceName || 'hanzo-ai',
        environment: config.environment || 'development',
        projectId: config.projectId
      },
      transports: [
        new winston.transports.Console(),
        // Could add HTTP transport to send logs to Hanzo Cloud
      ]
    });
  }
  
  private initializeOpenTelemetry(config: HanzoCloudConfig): void {
    // Enable OpenTelemetry debugging in development
    if (config.environment === 'development') {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
    }
    
    // Create resource
    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: config.serviceName || 'hanzo-ai',
      [SemanticResourceAttributes.SERVICE_VERSION]: config.serviceVersion || '1.0.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: config.environment || 'development',
      'hanzo.project.id': config.projectId,
      'hanzo.cloud.region': process.env.HANZO_CLOUD_REGION || 'us-east-1'
    });
    
    // Create OTLP exporter
    this.exporter = new OTLPTraceExporter({
      url: `${config.cloudUrl}/v1/traces`,
      headers: {
        'x-api-key': config.apiKey,
        'x-project-id': config.projectId
      }
    });
    
    // Create provider
    this.provider = new NodeTracerProvider({
      resource
    });
    
    // Add batch processor
    this.provider.addSpanProcessor(
      new BatchSpanProcessor(this.exporter, {
        maxQueueSize: 1000,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 30000
      })
    );
    
    // Register as global provider
    this.provider.register();
    
    // Register instrumentations for automatic tracing
    registerInstrumentations({
      instrumentations: [
        // Add instrumentations as needed
      ]
    });
  }
  
  private startMetricsFlush(config: HanzoCloudConfig): void {
    // Flush metrics every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flushMetrics(config);
    }, 30000);
    
    // Listen for metric events
    this.on('metric', (metric) => {
      const key = `${metric.name}:${metric.type}`;
      if (!this.metricsBuffer.has(key)) {
        this.metricsBuffer.set(key, []);
      }
      this.metricsBuffer.get(key)!.push(metric);
    });
  }
  
  private async flushMetrics(config: HanzoCloudConfig): Promise<void> {
    if (this.metricsBuffer.size === 0) return;
    
    const metrics = Array.from(this.metricsBuffer.entries()).map(([key, values]) => {
      const [name, type] = key.split(':');
      
      // Aggregate metrics
      if (type === 'counter') {
        const sum = values.reduce((acc, m) => acc + m.value, 0);
        return { name, type, value: sum, tags: values[0].tags };
      } else if (type === 'gauge') {
        // Use latest value for gauges
        return values[values.length - 1];
      } else if (type === 'histogram') {
        // Calculate percentiles for histograms
        const sorted = values.map(m => m.value).sort((a, b) => a - b);
        return {
          name,
          type,
          value: {
            count: sorted.length,
            min: sorted[0],
            max: sorted[sorted.length - 1],
            p50: sorted[Math.floor(sorted.length * 0.5)],
            p95: sorted[Math.floor(sorted.length * 0.95)],
            p99: sorted[Math.floor(sorted.length * 0.99)]
          },
          tags: values[0].tags
        };
      }
      return values[0];
    });
    
    // Send to Hanzo Cloud
    try {
      const response = await fetch(`${config.cloudUrl}/v1/metrics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'x-project-id': config.projectId
        },
        body: JSON.stringify({
          metrics,
          timestamp: Date.now()
        })
      });
      
      if (!response.ok) {
        this.logger.error('Failed to send metrics to Hanzo Cloud', {
          status: response.status,
          statusText: response.statusText
        });
      }
      
      // Clear buffer after successful send
      this.metricsBuffer.clear();
    } catch (error) {
      this.logger.error('Error sending metrics to Hanzo Cloud', { error });
    }
  }
  
  /**
   * Log a message with trace context
   */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: any): void {
    this.logger[level](message, meta);
  }
  
  /**
   * Record an agent execution
   */
  recordAgentExecution(agentName: string, duration: number, success: boolean, metadata?: any): void {
    this.increment('agent.executions', 1, {
      agent: agentName,
      success: success ? 'true' : 'false'
    });
    
    this.histogram('agent.execution.duration', duration, {
      agent: agentName
    });
    
    if (metadata?.tokens) {
      this.increment('agent.tokens.used', metadata.tokens, {
        agent: agentName,
        model: metadata.model || 'unknown'
      });
    }
    
    this.log('info', `Agent ${agentName} executed`, {
      agent: agentName,
      duration,
      success,
      ...metadata
    });
  }
  
  /**
   * Record a network execution
   */
  recordNetworkExecution(
    networkName: string,
    iterations: number,
    duration: number,
    agentExecutions: Map<string, number>
  ): void {
    this.increment('network.executions', 1, {
      network: networkName
    });
    
    this.histogram('network.iterations', iterations, {
      network: networkName
    });
    
    this.histogram('network.execution.duration', duration, {
      network: networkName
    });
    
    // Record per-agent metrics within the network
    for (const [agent, count] of agentExecutions) {
      this.increment('network.agent.executions', count, {
        network: networkName,
        agent
      });
    }
    
    this.log('info', `Network ${networkName} completed`, {
      network: networkName,
      iterations,
      duration,
      agents: Object.fromEntries(agentExecutions)
    });
  }
  
  /**
   * Record tool usage
   */
  recordToolUsage(toolName: string, agentName: string, duration: number, success: boolean): void {
    this.increment('tool.executions', 1, {
      tool: toolName,
      agent: agentName,
      success: success ? 'true' : 'false'
    });
    
    this.histogram('tool.execution.duration', duration, {
      tool: toolName,
      agent: agentName
    });
  }
  
  /**
   * Record MCP server connection
   */
  recordMCPConnection(serverName: string, success: boolean, metadata?: any): void {
    this.increment('mcp.connections', 1, {
      server: serverName,
      success: success ? 'true' : 'false'
    });
    
    if (success) {
      this.gauge('mcp.servers.active', 1, {
        server: serverName
      });
    }
    
    this.log('info', `MCP server ${serverName} connection ${success ? 'established' : 'failed'}`, {
      server: serverName,
      ...metadata
    });
  }
  
  /**
   * Create a session for tracking related executions
   */
  createSession(sessionId?: string): string {
    const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.setAttributes({ 'hanzo.session.id': id });
    return id;
  }
  
  /**
   * Enhanced shutdown with cleanup
   */
  async shutdown(): Promise<void> {
    // Clear intervals
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    
    // Flush remaining metrics
    await this.flushMetrics(this.config as HanzoCloudConfig);
    
    // Shutdown OpenTelemetry
    if (this.provider) {
      await this.provider.shutdown();
    }
    
    // Call parent shutdown
    await super.shutdown();
    
    this.logger.info('Hanzo Cloud telemetry shut down');
  }
}

/**
 * Create a Hanzo Cloud telemetry instance
 */
export function createHanzoCloudTelemetry(config: HanzoCloudConfig): HanzoCloudTelemetry {
  return new HanzoCloudTelemetry(config);
}