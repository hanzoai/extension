import { describe, it, expect, beforeAll } from 'vitest';
import { ACI, Point, Size, Region } from '../src/index';

describe('ACI - Agent Computer Interface', () => {
  describe('Type Exports', () => {
    it('should export Point interface', () => {
      const point: Point = { x: 100, y: 200 };
      expect(point.x).toBe(100);
      expect(point.y).toBe(200);
    });

    it('should export Size interface', () => {
      const size: Size = { width: 1920, height: 1080 };
      expect(size.width).toBe(1920);
      expect(size.height).toBe(1080);
    });

    it('should export Region interface', () => {
      const region: Region = { x: 0, y: 0, width: 100, height: 100 };
      expect(region.x).toBe(0);
      expect(region.y).toBe(0);
      expect(region.width).toBe(100);
      expect(region.height).toBe(100);
    });
  });

  describe('ACI Instance', () => {
    it('should create ACI instance with default options', () => {
      const aci = new ACI();
      expect(aci).toBeDefined();
      expect(aci).toBeInstanceOf(ACI);
    });

    it('should create ACI instance with custom options', () => {
      const aci = new ACI({
        defaultDelay: 200,
        screenshotFormat: 'jpeg',
        ocr: true
      });
      expect(aci).toBeDefined();
    });
  });

  describe('Utility Methods', () => {
    let aci: ACI;

    beforeAll(() => {
      aci = new ACI();
    });

    it('should have sleep method', async () => {
      const start = Date.now();
      await aci.sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(95);
      expect(elapsed).toBeLessThan(150);
    });

    it('should have dispose method', async () => {
      const testAci = new ACI({ ocr: true });
      await expect(testAci.dispose()).resolves.not.toThrow();
    });
  });

  describe('Method Signatures', () => {
    let aci: ACI;

    beforeAll(() => {
      aci = new ACI();
    });

    it('should have mouse operation methods', () => {
      expect(typeof aci.moveTo).toBe('function');
      expect(typeof aci.click).toBe('function');
      expect(typeof aci.doubleClick).toBe('function');
      expect(typeof aci.drag).toBe('function');
      expect(typeof aci.scroll).toBe('function');
    });

    it('should have keyboard operation methods', () => {
      expect(typeof aci.type).toBe('function');
      expect(typeof aci.press).toBe('function');
      expect(typeof aci.hotkey).toBe('function');
    });

    it('should have screen operation methods', () => {
      expect(typeof aci.screenshot).toBe('function');
      expect(typeof aci.getScreenSize).toBe('function');
      expect(typeof aci.locateOnScreen).toBe('function');
      expect(typeof aci.locateAllOnScreen).toBe('function');
    });

    it('should have OCR operation methods', () => {
      expect(typeof aci.readText).toBe('function');
      expect(typeof aci.findText).toBe('function');
    });

    it('should have high-level operation methods', () => {
      expect(typeof aci.clickImage).toBe('function');
      expect(typeof aci.clickText).toBe('function');
      expect(typeof aci.waitForImage).toBe('function');
      expect(typeof aci.waitForText).toBe('function');
    });
  });

  describe('Convenience Functions', () => {
    it('should export screenshot function', async () => {
      const { screenshot } = await import('../src/index');
      expect(typeof screenshot).toBe('function');
    });

    it('should export click function', async () => {
      const { click } = await import('../src/index');
      expect(typeof click).toBe('function');
    });

    it('should export type function', async () => {
      const { type } = await import('../src/index');
      expect(typeof type).toBe('function');
    });

    it('should export moveTo function', async () => {
      const { moveTo } = await import('../src/index');
      expect(typeof moveTo).toBe('function');
    });
  });

  describe('Default Export', () => {
    it('should export default ACI instance', async () => {
      const module = await import('../src/index');
      expect(module.default).toBeDefined();
      expect(module.default).toBeInstanceOf(ACI);
    });
  });
});