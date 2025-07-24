/**
 * Mode and palette system for context-aware tool selection
 */

import { Tool, ToolResult } from '../types';
import { allTools } from './index';

// Mode definitions
export interface Mode {
  name: string;
  description: string;
  tools: string[]; // Tool names included in this mode
  prompt?: string; // Optional prompt template for this mode
}

// Palette definitions
export interface Palette {
  name: string;
  description: string;
  modes: string[]; // Mode names included in this palette
  shortcuts?: Record<string, string>; // Shortcut commands
}

// Built-in modes
const builtInModes: Mode[] = [
  {
    name: 'developer',
    description: 'Full development mode with all tools',
    tools: ['*'], // Special case: all tools
    prompt: 'You are a helpful AI assistant with access to development tools.'
  },
  {
    name: 'research',
    description: 'Research and exploration mode',
    tools: [
      'read_file',
      'list_files',
      'tree',
      'grep',
      'find_files',
      'search',
      'ast_search',
      'find_symbol',
      'analyze_dependencies',
      'think',
      'consensus'
    ],
    prompt: 'You are a research assistant focused on understanding and analyzing code.'
  },
  {
    name: 'editor',
    description: 'Code editing and modification mode',
    tools: [
      'read_file',
      'write_file',
      'edit_file',
      'multi_edit',
      'create_file',
      'delete_file',
      'move_file',
      'grep',
      'ast_search'
    ],
    prompt: 'You are a code editor assistant focused on making precise code changes.'
  },
  {
    name: 'terminal',
    description: 'Terminal and shell operations mode',
    tools: [
      'bash',
      'shell',
      'background_bash',
      'kill_process',
      'list_processes',
      'read_file',
      'write_file'
    ],
    prompt: 'You are a terminal assistant focused on system operations.'
  },
  {
    name: 'ai_assistant',
    description: 'AI-powered assistance mode',
    tools: [
      'think',
      'critic',
      'consensus',
      'agent',
      'vector_index',
      'vector_search',
      'todo_add',
      'todo_list'
    ],
    prompt: 'You are an AI assistant that can think deeply and delegate tasks.'
  },
  {
    name: 'project_manager',
    description: 'Project management mode',
    tools: [
      'todo_add',
      'todo_list',
      'todo_update',
      'todo_delete',
      'todo_stats',
      'tree',
      'analyze_dependencies',
      'think'
    ],
    prompt: 'You are a project manager focused on task organization and tracking.'
  }
];

// Built-in palettes
const builtInPalettes: Palette[] = [
  {
    name: 'default',
    description: 'Default palette with all modes',
    modes: ['developer'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'cd': 'bash cd',
      'pwd': 'bash pwd',
      'find': 'find_files',
      'search': 'grep'
    }
  },
  {
    name: 'minimal',
    description: 'Minimal palette for basic operations',
    modes: ['research', 'editor'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'edit': 'edit_file'
    }
  },
  {
    name: 'power',
    description: 'Power user palette with all capabilities',
    modes: ['developer', 'ai_assistant', 'project_manager'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'cd': 'bash cd',
      'pwd': 'bash pwd',
      'find': 'find_files',
      'search': 'unified_search',
      'todo': 'todo_list',
      'think': 'think'
    }
  }
];

// Current active mode and palette
let currentMode: Mode = builtInModes[0];
let currentPalette: Palette = builtInPalettes[0];
let customModes: Mode[] = [];
let customPalettes: Palette[] = [];

// Get all available modes
function getAllModes(): Mode[] {
  return [...builtInModes, ...customModes];
}

// Get all available palettes
function getAllPalettes(): Palette[] {
  return [...builtInPalettes, ...customPalettes];
}

// Get tools for current mode
function getToolsForMode(mode: Mode): string[] {
  if (mode.tools.includes('*')) {
    return allTools.map(t => t.name);
  }
  return mode.tools;
}

export const modeSwitchTool: Tool = {
  name: 'mode_switch',
  description: 'Switch to a different tool mode',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'Mode name to switch to'
      }
    },
    required: ['mode']
  },
  handler: async (args) => {
    const modes = getAllModes();
    const mode = modes.find(m => m.name === args.mode);
    
    if (!mode) {
      const availableModes = modes.map(m => m.name).join(', ');
      return {
        content: [{
          type: 'text',
          text: `Mode '${args.mode}' not found. Available modes: ${availableModes}`
        }],
        isError: true
      };
    }
    
    currentMode = mode;
    const tools = getToolsForMode(mode);
    
    return {
      content: [{
        type: 'text',
        text: `🎯 Switched to ${mode.name} mode\n${mode.description}\n\nAvailable tools (${tools.length}): ${tools.slice(0, 10).join(', ')}${tools.length > 10 ? '...' : ''}`
      }]
    };
  }
};

export const modeListTool: Tool = {
  name: 'mode_list',
  description: 'List available modes',
  inputSchema: {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description: 'Show detailed information',
        default: false
      }
    }
  },
  handler: async (args) => {
    const modes = getAllModes();
    const output = ['📋 Available Modes\n'];
    
    for (const mode of modes) {
      const isActive = mode.name === currentMode.name;
      const tools = getToolsForMode(mode);
      
      output.push(`${isActive ? '▶️' : '  '} ${mode.name}${isActive ? ' (active)' : ''}`);
      output.push(`   ${mode.description}`);
      
      if (args.verbose) {
        output.push(`   Tools (${tools.length}): ${tools.slice(0, 5).join(', ')}${tools.length > 5 ? '...' : ''}`);
        if (mode.prompt) {
          output.push(`   Prompt: ${mode.prompt.substring(0, 50)}...`);
        }
      }
      
      output.push('');
    }
    
    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  }
};

export const paletteSelectTool: Tool = {
  name: 'palette_select',
  description: 'Select a tool palette',
  inputSchema: {
    type: 'object',
    properties: {
      palette: {
        type: 'string',
        description: 'Palette name to select'
      }
    },
    required: ['palette']
  },
  handler: async (args) => {
    const palettes = getAllPalettes();
    const palette = palettes.find(p => p.name === args.palette);
    
    if (!palette) {
      const availablePalettes = palettes.map(p => p.name).join(', ');
      return {
        content: [{
          type: 'text',
          text: `Palette '${args.palette}' not found. Available palettes: ${availablePalettes}`
        }],
        isError: true
      };
    }
    
    currentPalette = palette;
    
    // Auto-switch to first mode in palette
    if (palette.modes.length > 0) {
      const modes = getAllModes();
      const firstMode = modes.find(m => m.name === palette.modes[0]);
      if (firstMode) {
        currentMode = firstMode;
      }
    }
    
    const shortcuts = Object.entries(palette.shortcuts || {})
      .map(([k, v]) => `${k} → ${v}`)
      .join(', ');
    
    return {
      content: [{
        type: 'text',
        text: `🎨 Selected ${palette.name} palette\n${palette.description}\n\nModes: ${palette.modes.join(', ')}\nShortcuts: ${shortcuts || 'none'}`
      }]
    };
  }
};

export const paletteListTool: Tool = {
  name: 'palette_list',
  description: 'List available palettes',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  handler: async (args) => {
    const palettes = getAllPalettes();
    const output = ['🎨 Available Palettes\n'];
    
    for (const palette of palettes) {
      const isActive = palette.name === currentPalette.name;
      
      output.push(`${isActive ? '▶️' : '  '} ${palette.name}${isActive ? ' (active)' : ''}`);
      output.push(`   ${palette.description}`);
      output.push(`   Modes: ${palette.modes.join(', ')}`);
      
      if (palette.shortcuts && Object.keys(palette.shortcuts).length > 0) {
        const shortcuts = Object.entries(palette.shortcuts)
          .slice(0, 3)
          .map(([k, v]) => `${k}→${v}`)
          .join(', ');
        output.push(`   Shortcuts: ${shortcuts}${Object.keys(palette.shortcuts).length > 3 ? '...' : ''}`);
      }
      
      output.push('');
    }
    
    return {
      content: [{
        type: 'text',
        text: output.join('\n')
      }]
    };
  }
};

export const modeCreateTool: Tool = {
  name: 'mode_create',
  description: 'Create a custom mode',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Mode name'
      },
      description: {
        type: 'string',
        description: 'Mode description'
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tool names to include'
      },
      prompt: {
        type: 'string',
        description: 'Optional prompt template'
      }
    },
    required: ['name', 'description', 'tools']
  },
  handler: async (args) => {
    // Check if mode already exists
    const existing = getAllModes().find(m => m.name === args.name);
    if (existing) {
      return {
        content: [{
          type: 'text',
          text: `Mode '${args.name}' already exists`
        }],
        isError: true
      };
    }
    
    // Validate tools
    const validTools = allTools.map(t => t.name);
    const invalidTools = args.tools.filter(t => t !== '*' && !validTools.includes(t));
    
    if (invalidTools.length > 0) {
      return {
        content: [{
          type: 'text',
          text: `Invalid tools: ${invalidTools.join(', ')}`
        }],
        isError: true
      };
    }
    
    const newMode: Mode = {
      name: args.name,
      description: args.description,
      tools: args.tools,
      prompt: args.prompt
    };
    
    customModes.push(newMode);
    
    return {
      content: [{
        type: 'text',
        text: `✅ Created mode '${newMode.name}' with ${newMode.tools.length} tools`
      }]
    };
  }
};

export const shortcutTool: Tool = {
  name: 'shortcut',
  description: 'Execute a palette shortcut',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shortcut command to execute'
      },
      args: {
        type: 'object',
        description: 'Arguments to pass to the tool'
      }
    },
    required: ['command']
  },
  handler: async (args) => {
    const shortcuts = currentPalette.shortcuts || {};
    const toolName = shortcuts[args.command];
    
    if (!toolName) {
      return {
        content: [{
          type: 'text',
          text: `Shortcut '${args.command}' not found. Available shortcuts: ${Object.keys(shortcuts).join(', ')}`
        }],
        isError: true
      };
    }
    
    // Check if tool is available in current mode
    const availableTools = getToolsForMode(currentMode);
    if (!availableTools.includes(toolName)) {
      return {
        content: [{
          type: 'text',
          text: `Tool '${toolName}' is not available in ${currentMode.name} mode`
        }],
        isError: true
      };
    }
    
    return {
      content: [{
        type: 'text',
        text: `Executing ${toolName}...`
      }]
    };
  }
};

// Export mode/palette tools
export const modePaletteTools = [
  modeSwitchTool,
  modeListTool,
  paletteSelectTool,
  paletteListTool,
  modeCreateTool,
  shortcutTool
];

// Export utility functions for use by MCP server
export const modeUtils = {
  getCurrentMode: () => currentMode,
  getCurrentPalette: () => currentPalette,
  getAvailableTools: () => getToolsForMode(currentMode),
  isToolAvailable: (toolName: string) => getToolsForMode(currentMode).includes(toolName),
  getAllModes,
  getAllPalettes
};