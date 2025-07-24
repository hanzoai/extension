import { describe, it, expect, beforeEach } from 'vitest';
import { 
  modePresetTools,
  modeUtils,
  modeSwitchTool,
  modeListTool,
  presetSelectTool,
  presetListTool,
  modeCreateTool,
  shortcutTool
} from '../src/tools/mode-preset.js';

describe('Mode and Preset System', () => {
  describe('Mode Utils', () => {
    it('should get current mode', () => {
      const currentMode = modeUtils.getCurrentMode();
      expect(currentMode).toBeDefined();
      expect(currentMode.name).toBe('developer');
      expect(currentMode.tools).toContain('*');
    });

    it('should get current mode preset', () => {
      const currentModePreset = modeUtils.getCurrentModePreset();
      expect(currentModePreset).toBeDefined();
      expect(currentModePreset.name).toBe('default');
      expect(currentModePreset.modes).toContain('developer');
    });

    it('should get available tools', () => {
      const tools = modeUtils.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should check if tool is available', () => {
      // In developer mode, all tools should be available
      expect(modeUtils.isToolAvailable('read_file')).toBe(true);
      expect(modeUtils.isToolAvailable('bash')).toBe(true);
      expect(modeUtils.isToolAvailable('think')).toBe(true);
    });

    it('should get all modes', () => {
      const modes = modeUtils.getAllModes();
      expect(Array.isArray(modes)).toBe(true);
      expect(modes.length).toBeGreaterThanOrEqual(45); // We have 45 modes
      
      const modeNames = modes.map(m => m.name);
      // Original modes
      expect(modeNames).toContain('developer');
      expect(modeNames).toContain('research');
      expect(modeNames).toContain('editor');
      expect(modeNames).toContain('terminal');
      expect(modeNames).toContain('ai_assistant');
      expect(modeNames).toContain('project_manager');
      
      // Language creators
      expect(modeNames).toContain('ritchie');
      expect(modeNames).toContain('guido');
      expect(modeNames).toContain('bjarne');
      expect(modeNames).toContain('larry');
      
      // Systems
      expect(modeNames).toContain('linus');
      expect(modeNames).toContain('graydon');
      expect(modeNames).toContain('rob');
      expect(modeNames).toContain('ken');
      
      // AI/ML
      expect(modeNames).toContain('yann');
      expect(modeNames).toContain('geoffrey');
      expect(modeNames).toContain('andrej');
      
      // Special configurations
      expect(modeNames).toContain('hanzo');
      expect(modeNames).toContain('10x');
      expect(modeNames).toContain('devops');
      expect(modeNames).toContain('enterprise');
    });

    it('should get all mode presets', () => {
      const presets = modeUtils.getAllModePresets();
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThanOrEqual(13); // We have 13 presets
      
      const presetNames = presets.map(p => p.name);
      expect(presetNames).toContain('default');
      expect(presetNames).toContain('minimal');
      expect(presetNames).toContain('power');
      expect(presetNames).toContain('unix');
      expect(presetNames).toContain('modern');
      expect(presetNames).toContain('web');
      expect(presetNames).toContain('scripting');
      expect(presetNames).toContain('systems');
      expect(presetNames).toContain('database');
      expect(presetNames).toContain('ai_ml');
      expect(presetNames).toContain('enterprise_dev');
      expect(presetNames).toContain('startup_mode');
      expect(presetNames).toContain('research');
    });
  });

  describe('Mode Tools', () => {
    it('should export all mode/preset tools', () => {
      expect(modePresetTools).toBeDefined();
      expect(Array.isArray(modePresetTools)).toBe(true);
      expect(modePresetTools.length).toBe(6);
    });

    it('mode_switch tool should have correct structure', () => {
      expect(modeSwitchTool.name).toBe('mode_switch');
      expect(modeSwitchTool.description).toContain('Switch');
      expect(modeSwitchTool.inputSchema.properties.mode).toBeDefined();
      expect(modeSwitchTool.inputSchema.required).toContain('mode');
    });

    it('mode_list tool should have correct structure', () => {
      expect(modeListTool.name).toBe('mode_list');
      expect(modeListTool.description).toContain('List');
      expect(modeListTool.inputSchema.properties.verbose).toBeDefined();
    });

    it('preset_select tool should have correct structure', () => {
      expect(presetSelectTool.name).toBe('preset_select');
      expect(presetSelectTool.description).toContain('preset');
      expect(presetSelectTool.inputSchema.properties.preset).toBeDefined();
      expect(presetSelectTool.inputSchema.required).toContain('preset');
    });

    it('mode_create tool should have correct structure', () => {
      expect(modeCreateTool.name).toBe('mode_create');
      expect(modeCreateTool.description).toContain('Create');
      expect(modeCreateTool.inputSchema.properties.name).toBeDefined();
      expect(modeCreateTool.inputSchema.properties.description).toBeDefined();
      expect(modeCreateTool.inputSchema.properties.tools).toBeDefined();
      expect(modeCreateTool.inputSchema.required).toEqual(['name', 'description', 'tools']);
    });

    it('shortcut tool should have correct structure', () => {
      expect(shortcutTool.name).toBe('shortcut');
      expect(shortcutTool.description).toContain('shortcut');
      expect(shortcutTool.inputSchema.properties.command).toBeDefined();
      expect(shortcutTool.inputSchema.properties.args).toBeDefined();
      expect(shortcutTool.inputSchema.required).toContain('command');
    });
  });

  describe('Mode Switching', () => {
    it('should switch between modes', async () => {
      // Test switching to research mode
      const result = await modeSwitchTool.handler({ mode: 'research' });
      expect(result.content[0].text).toContain('Switched to research mode');
      
      const currentMode = modeUtils.getCurrentMode();
      expect(currentMode.name).toBe('research');
    });

    it('should switch to programmer modes', async () => {
      // Test switching to guido (Python) mode
      const result = await modeSwitchTool.handler({ mode: 'guido' });
      expect(result.content[0].text).toContain('Switched to guido mode');
      expect(result.content[0].text).toContain('Guido van Rossum');
      
      const currentMode = modeUtils.getCurrentMode();
      expect(currentMode.name).toBe('guido');
      expect(currentMode.prompt).toContain('Readability counts');
    });

    it('should handle invalid mode switch', async () => {
      const result = await modeSwitchTool.handler({ mode: 'invalid_mode' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('Mode Listing', () => {
    it('should list available modes', async () => {
      const result = await modeListTool.handler({});
      expect(result.content[0].text).toContain('Available Modes');
      expect(result.content[0].text).toContain('developer');
      expect(result.content[0].text).toContain('research');
    });

    it('should show verbose mode information', async () => {
      const result = await modeListTool.handler({ verbose: true });
      expect(result.content[0].text).toContain('Tools');
    });
  });

  describe('Custom Mode Creation', () => {
    it('should create custom mode', async () => {
      const result = await modeCreateTool.handler({
        name: 'test_mode',
        description: 'Test mode for unit testing',
        tools: ['read_file', 'write_file']
      });
      
      expect(result.content[0].text).toContain('Created mode');
      expect(result.content[0].text).toContain('test_mode');
      
      // Verify mode was added
      const modes = modeUtils.getAllModes();
      expect(modes.some(m => m.name === 'test_mode')).toBe(true);
    });

    it('should prevent duplicate mode names', async () => {
      // First create a mode
      await modeCreateTool.handler({
        name: 'duplicate_test',
        description: 'Test',
        tools: ['read_file']
      });
      
      // Try to create with same name
      const result = await modeCreateTool.handler({
        name: 'duplicate_test',
        description: 'Another test',
        tools: ['write_file']
      });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('already exists');
    });

    it('should validate tool names', async () => {
      const result = await modeCreateTool.handler({
        name: 'invalid_tools_mode',
        description: 'Mode with invalid tools',
        tools: ['read_file', 'invalid_tool_name']
      });
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid tools');
    });
  });
});