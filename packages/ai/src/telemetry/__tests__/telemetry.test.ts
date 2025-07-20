import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Telemetry } from '../index';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';

describe('Telemetry', () => {
  let telemetry: Telemetry;
  
  beforeEach(() => {
    telemetry = new Telemetry({
      serviceName: 'test-service',
      enabled: true
    });
  });
  
  afterEach(async () => {
    await telemetry.shutdown();
  });
  
  describe('span operations', () => {
    it('should create and end spans', () => {
      const span = telemetry.startSpan('test-span', {
        kind: SpanKind.INTERNAL,
        attributes: { 'test.attr': 'value' }
      });
      
      expect(span).toBeDefined();
      expect(span.end).toBeInstanceOf(Function);
      
      telemetry.endSpan('test-span', { code: SpanStatusCode.OK });
    });
    
    it('should trace async operations', async () => {
      const result = await telemetry.trace(
        'async-operation',
        async (span) => {
          span.setAttribute('operation.type', 'test');
          return 'success';
        }
      );
      
      expect(result).toBe('success');
    });
    
    it('should trace sync operations', () => {
      const result = telemetry.traceSync(
        'sync-operation',
        (span) => {
          span.setAttribute('operation.type', 'test');
          return 42;
        }
      );
      
      expect(result).toBe(42);
    });
    
    it('should handle errors in traced operations', async () => {
      const error = new Error('Test error');
      
      await expect(
        telemetry.trace('failing-operation', async () => {
          throw error;
        })
      ).rejects.toThrow('Test error');
    });
  });
  
  describe('events and attributes', () => {
    it('should record events', () => {
      const span = telemetry.startSpan('test-span');
      
      telemetry.recordEvent({
        name: 'test.event',
        attributes: { 'event.type': 'test' },
        timestamp: Date.now()
      }, span);
      
      telemetry.endSpan('test-span');
    });
    
    it('should set attributes', () => {
      const span = telemetry.startSpan('test-span');
      
      telemetry.setAttributes({
        'attr1': 'value1',
        'attr2': 42,
        'attr3': true
      }, span);
      
      telemetry.endSpan('test-span');
    });
    
    it('should record exceptions', () => {
      const span = telemetry.startSpan('test-span');
      const error = new Error('Test exception');
      
      telemetry.recordException(error, span);
      
      telemetry.endSpan('test-span');
    });
  });
  
  describe('metrics', () => {
    it('should emit metric events', () => {
      const metricHandler = vi.fn();
      telemetry.on('metric', metricHandler);
      
      telemetry.increment('test.counter', 1, { tag: 'value' });
      
      expect(metricHandler).toHaveBeenCalledWith({
        name: 'test.counter',
        value: 1,
        type: 'counter',
        tags: expect.objectContaining({ tag: 'value' }),
        timestamp: expect.any(Number)
      });
    });
    
    it('should record gauges', () => {
      const metricHandler = vi.fn();
      telemetry.on('metric', metricHandler);
      
      telemetry.gauge('test.gauge', 42);
      
      expect(metricHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.gauge',
          value: 42,
          type: 'gauge'
        })
      );
    });
    
    it('should record histograms', () => {
      const metricHandler = vi.fn();
      telemetry.on('metric', metricHandler);
      
      telemetry.histogram('test.histogram', 123);
      
      expect(metricHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test.histogram',
          value: 123,
          type: 'histogram'
        })
      );
    });
  });
  
  describe('context propagation', () => {
    it('should get trace context', async () => {
      await telemetry.trace('test-op', async () => {
        const context = telemetry.getTraceContext();
        
        expect(context).toBeInstanceOf(Object);
        // In test environment with noop tracer, context might be empty
        // This is expected behavior
      });
    });
    
    it('should create child telemetry instances', () => {
      const child = telemetry.createChild('child-service', {
        'child.attr': 'value'
      });
      
      expect(child).toBeInstanceOf(Telemetry);
      expect(child).not.toBe(telemetry);
    });
  });
  
  describe('lifecycle', () => {
    it('should flush pending data', async () => {
      const flushHandler = vi.fn();
      telemetry.on('flush', flushHandler);
      
      // Create some spans
      telemetry.startSpan('span1');
      telemetry.startSpan('span2');
      
      await telemetry.flush();
      
      expect(flushHandler).toHaveBeenCalled();
    });
    
    it('should shutdown cleanly', async () => {
      const span = telemetry.startSpan('test-span');
      
      await telemetry.shutdown();
      
      // Should not throw
      telemetry.endSpan('test-span');
    });
  });
  
  describe('disabled telemetry', () => {
    it('should not create real spans when disabled', () => {
      const disabledTelemetry = new Telemetry({
        serviceName: 'test',
        enabled: false
      });
      
      const span = disabledTelemetry.startSpan('test-span');
      
      // Should return a no-op span
      expect(span).toBeDefined();
      expect(span.end).toBeInstanceOf(Function);
      
      // Should not throw
      span.end();
    });
    
    it('should not emit metrics when disabled', () => {
      const disabledTelemetry = new Telemetry({
        serviceName: 'test',
        enabled: false
      });
      
      const metricHandler = vi.fn();
      disabledTelemetry.on('metric', metricHandler);
      
      disabledTelemetry.increment('test.counter');
      
      expect(metricHandler).not.toHaveBeenCalled();
    });
  });
});