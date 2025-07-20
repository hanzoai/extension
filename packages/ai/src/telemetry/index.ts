/**
 * Telemetry integration for Hanzo AI
 * Provides distributed tracing, logging, and metrics for agent executions
 */

import * as opentelemetry from '@opentelemetry/api';
import { Span, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { EventEmitter } from 'events';

export interface TelemetryConfig {
  serviceName?: string;
  enabled?: boolean;
  cloudUrl?: string;
  apiKey?: string;
  projectId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
}

export interface TelemetryEvent {
  name: string;
  attributes?: Record<string, any>;
  timestamp?: number;
}

export class Telemetry extends EventEmitter {
  private tracer: opentelemetry.Tracer;
  private enabled: boolean;
  private config: TelemetryConfig;
  private activeSpans: Map<string, Span> = new Map();
  
  constructor(config: TelemetryConfig = {}) {
    super();
    this.config = {
      serviceName: 'hanzo-ai',
      enabled: true,
      ...config
    };
    
    this.enabled = this.config.enabled ?? true;
    this.tracer = opentelemetry.trace.getTracer(
      this.config.serviceName || 'hanzo-ai',
      '1.0.0'
    );
  }
  
  /**
   * Start a new span for tracing
   */
  startSpan(
    name: string,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      parent?: Span | SpanContext;
    }
  ): Span {
    if (!this.enabled) {
      return opentelemetry.trace.getTracer('noop').startSpan('noop');
    }
    
    const spanOptions: opentelemetry.SpanOptions = {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: {
        'service.name': this.config.serviceName,
        'hanzo.ai.version': '1.0.0',
        ...this.config.metadata,
        ...options?.attributes
      }
    };
    
    // Handle parent span
    let context = opentelemetry.context.active();
    if (options?.parent) {
      if ('spanContext' in options.parent) {
        // It's a Span
        context = opentelemetry.trace.setSpan(context, options.parent);
      } else {
        // It's a SpanContext - need to create a parent span
        const parentSpan = this.tracer.startSpan('parent', {
          context: opentelemetry.trace.setSpanContext(
            opentelemetry.ROOT_CONTEXT,
            options.parent as SpanContext
          )
        });
        context = opentelemetry.trace.setSpan(context, parentSpan);
      }
    }
    
    const span = this.tracer.startSpan(name, spanOptions, context);
    this.activeSpans.set(name, span);
    
    // Add default attributes
    if (this.config.projectId) {
      span.setAttribute('hanzo.project.id', this.config.projectId);
    }
    if (this.config.sessionId) {
      span.setAttribute('hanzo.session.id', this.config.sessionId);
    }
    
    return span;
  }
  
  /**
   * End a span
   */
  endSpan(name: string, status?: { code: SpanStatusCode; message?: string }): void {
    const span = this.activeSpans.get(name);
    if (span) {
      if (status) {
        span.setStatus(status);
      }
      span.end();
      this.activeSpans.delete(name);
    }
  }
  
  /**
   * Trace an async operation
   */
  async trace<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): Promise<T> {
    const span = this.startSpan(name, options);
    
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.recordException(error as Error, span);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
      this.activeSpans.delete(name);
    }
  }
  
  /**
   * Trace a sync operation
   */
  traceSync<T>(
    name: string,
    fn: (span: Span) => T,
    options?: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    }
  ): T {
    const span = this.startSpan(name, options);
    
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      this.recordException(error as Error, span);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      span.end();
      this.activeSpans.delete(name);
    }
  }
  
  /**
   * Record an exception in the current or specified span
   */
  recordException(error: Error, span?: Span): void {
    const activeSpan = span || this.getCurrentSpan();
    if (!activeSpan) return;
    
    activeSpan.recordException({
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Add error attributes for observability platforms
    activeSpan.setAttributes({
      'error.type': error.name,
      'error.message': error.message,
      'error.stack': error.stack
    });
  }
  
  /**
   * Record an event in the current or specified span
   */
  recordEvent(event: TelemetryEvent, span?: Span): void {
    const activeSpan = span || this.getCurrentSpan();
    if (!activeSpan) return;
    
    activeSpan.addEvent(event.name, event.attributes, event.timestamp);
  }
  
  /**
   * Set attributes on the current or specified span
   */
  setAttributes(attributes: Record<string, any>, span?: Span): void {
    const activeSpan = span || this.getCurrentSpan();
    if (!activeSpan) return;
    
    activeSpan.setAttributes(attributes);
  }
  
  /**
   * Get the currently active span
   */
  getCurrentSpan(): Span | undefined {
    return opentelemetry.trace.getActiveSpan();
  }
  
  /**
   * Get the current trace context for propagation
   */
  getTraceContext(): Record<string, string> {
    const span = this.getCurrentSpan();
    if (!span) return {};
    
    const carrier: Record<string, string> = {};
    opentelemetry.propagation.inject(
      opentelemetry.trace.setSpan(opentelemetry.context.active(), span),
      carrier
    );
    
    return carrier;
  }
  
  /**
   * Create a child telemetry instance with inherited context
   */
  createChild(name: string, attributes?: Record<string, any>): Telemetry {
    return new Telemetry({
      ...this.config,
      metadata: {
        ...this.config.metadata,
        ...attributes,
        parent: name
      }
    });
  }
  
  /**
   * Record metrics
   */
  recordMetric(
    name: string,
    value: number,
    type: 'counter' | 'gauge' | 'histogram' = 'gauge',
    tags?: Record<string, string | number>
  ): void {
    if (!this.enabled) return;
    
    // Emit metric event for collection
    this.emit('metric', {
      name,
      value,
      type,
      tags: {
        ...this.config.metadata,
        ...tags
      },
      timestamp: Date.now()
    });
  }
  
  /**
   * Increment a counter metric
   */
  increment(name: string, value: number = 1, tags?: Record<string, string | number>): void {
    this.recordMetric(name, value, 'counter', tags);
  }
  
  /**
   * Record a gauge metric
   */
  gauge(name: string, value: number, tags?: Record<string, string | number>): void {
    this.recordMetric(name, value, 'gauge', tags);
  }
  
  /**
   * Record a histogram metric
   */
  histogram(name: string, value: number, tags?: Record<string, string | number>): void {
    this.recordMetric(name, value, 'histogram', tags);
  }
  
  /**
   * Flush all pending telemetry data
   */
  async flush(): Promise<void> {
    // End all active spans
    for (const [name, span] of this.activeSpans) {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    }
    this.activeSpans.clear();
    
    // Emit flush event for collectors
    this.emit('flush');
  }
  
  /**
   * Shutdown telemetry
   */
  async shutdown(): Promise<void> {
    await this.flush();
    this.removeAllListeners();
  }
}

// Global telemetry instance
let globalTelemetry: Telemetry | undefined;

/**
 * Get or create the global telemetry instance
 */
export function getTelemetry(config?: TelemetryConfig): Telemetry {
  if (!globalTelemetry) {
    globalTelemetry = new Telemetry(config);
  }
  return globalTelemetry;
}

/**
 * Set the global telemetry instance
 */
export function setTelemetry(telemetry: Telemetry): void {
  globalTelemetry = telemetry;
}

// Export types
export { Span, SpanStatusCode, SpanKind } from '@opentelemetry/api';