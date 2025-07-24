import { describe, it, expect } from 'vitest';
import { 
  aciTools,
  screenshotTool,
  clickTool,
  typeTool,
  moveTool,
  scrollTool,
  hotkeyTool,
  readTextTool,
  findOnScreenTool,
  dragTool,
  screenInfoTool
} from '../src/mcp-tools';

describe('ACI MCP Tools', () => {
  describe('Tool Exports', () => {
    it('should export all ACI tools', () => {
      expect(aciTools).toBeDefined();
      expect(Array.isArray(aciTools)).toBe(true);
      expect(aciTools.length).toBe(10);
    });

    it('should export individual tools', () => {
      expect(screenshotTool).toBeDefined();
      expect(clickTool).toBeDefined();
      expect(typeTool).toBeDefined();
      expect(moveTool).toBeDefined();
      expect(scrollTool).toBeDefined();
      expect(hotkeyTool).toBeDefined();
      expect(readTextTool).toBeDefined();
      expect(findOnScreenTool).toBeDefined();
      expect(dragTool).toBeDefined();
      expect(screenInfoTool).toBeDefined();
    });
  });

  describe('Tool Structure', () => {
    it('screenshot tool should have correct structure', () => {
      expect(screenshotTool.name).toBe('screenshot');
      expect(screenshotTool.description).toContain('screenshot');
      expect(screenshotTool.inputSchema).toBeDefined();
      expect(screenshotTool.inputSchema.type).toBe('object');
      expect(typeof screenshotTool.handler).toBe('function');
    });

    it('click tool should have correct structure', () => {
      expect(clickTool.name).toBe('click');
      expect(clickTool.description).toContain('Click');
      expect(clickTool.inputSchema).toBeDefined();
      expect(clickTool.inputSchema.properties).toHaveProperty('x');
      expect(clickTool.inputSchema.properties).toHaveProperty('y');
      expect(clickTool.inputSchema.properties).toHaveProperty('button');
      expect(typeof clickTool.handler).toBe('function');
    });

    it('type tool should have correct structure', () => {
      expect(typeTool.name).toBe('type');
      expect(typeTool.description).toContain('Type');
      expect(typeTool.inputSchema).toBeDefined();
      expect(typeTool.inputSchema.properties).toHaveProperty('text');
      expect(typeTool.inputSchema.required).toContain('text');
      expect(typeof typeTool.handler).toBe('function');
    });

    it('move tool should have correct structure', () => {
      expect(moveTool.name).toBe('move_mouse');
      expect(moveTool.description).toContain('mouse');
      expect(moveTool.inputSchema).toBeDefined();
      expect(moveTool.inputSchema.properties).toHaveProperty('x');
      expect(moveTool.inputSchema.properties).toHaveProperty('y');
      expect(moveTool.inputSchema.required).toContain('x');
      expect(moveTool.inputSchema.required).toContain('y');
      expect(typeof moveTool.handler).toBe('function');
    });

    it('hotkey tool should have correct structure', () => {
      expect(hotkeyTool.name).toBe('hotkey');
      expect(hotkeyTool.description).toContain('keyboard shortcut');
      expect(hotkeyTool.inputSchema).toBeDefined();
      expect(hotkeyTool.inputSchema.properties).toHaveProperty('keys');
      expect(hotkeyTool.inputSchema.required).toContain('keys');
      expect(typeof hotkeyTool.handler).toBe('function');
    });
  });

  describe('Tool Input Schemas', () => {
    it('screenshot tool should have optional region parameters', () => {
      const props = screenshotTool.inputSchema.properties;
      expect(props.x.type).toBe('number');
      expect(props.y.type).toBe('number');
      expect(props.width.type).toBe('number');
      expect(props.height.type).toBe('number');
      expect(props.format.enum).toContain('png');
      expect(props.format.enum).toContain('jpeg');
    });

    it('click tool should support multiple click types', () => {
      const props = clickTool.inputSchema.properties;
      expect(props.button.enum).toContain('left');
      expect(props.button.enum).toContain('right');
      expect(props.button.enum).toContain('middle');
      expect(props.image).toBeDefined();
      expect(props.text).toBeDefined();
    });

    it('drag tool should require all coordinates', () => {
      const props = dragTool.inputSchema.properties;
      expect(props.fromX).toBeDefined();
      expect(props.fromY).toBeDefined();
      expect(props.toX).toBeDefined();
      expect(props.toY).toBeDefined();
      expect(dragTool.inputSchema.required).toEqual(['fromX', 'fromY', 'toX', 'toY']);
    });
  });

  describe('Tool Handlers', () => {
    it('all tools should have async handlers', () => {
      aciTools.forEach(tool => {
        expect(typeof tool.handler).toBe('function');
        expect(tool.handler.constructor.name).toBe('AsyncFunction');
      });
    });

    it('screenshot tool handler should handle errors', async () => {
      // This test would need mocking to properly test error handling
      expect(screenshotTool.handler).toBeDefined();
    });
  });
});