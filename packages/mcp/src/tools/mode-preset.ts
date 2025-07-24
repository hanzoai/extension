/**
 * Mode and mode preset system for context-aware tool selection
 */

import { Tool, ToolResult } from '../types';
import { getAllRegisteredTools } from './tool-registry';

// Mode definitions
export interface Mode {
  name: string;
  description: string;
  tools: string[]; // Tool names included in this mode
  prompt?: string; // Optional prompt template for this mode
}

// Mode Preset definitions
export interface ModePreset {
  name: string;
  description: string;
  modes: string[]; // Mode names included in this preset
  shortcuts?: Record<string, string>; // Shortcut commands
}

// Built-in modes
const builtInModes: Mode[] = [
  // Original modes
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
      'directory_tree',
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
      'run_command',
      'run_background',
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
      'directory_tree',
      'analyze_dependencies',
      'think'
    ],
    prompt: 'You are a project manager focused on task organization and tracking.'
  },

  // Language Creator modes
  {
    name: 'ritchie',
    description: 'Dennis Ritchie - C creator, UNIX philosophy',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash', 'run_command'],
    prompt: 'UNIX: Do one thing and do it well. Keep it simple, efficient, and portable.'
  },
  {
    name: 'guido',
    description: 'Guido van Rossum - Python creator, readability counts',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'think', 'todo_add'],
    prompt: 'There should be one-- and preferably only one --obvious way to do it. Readability counts.'
  },
  {
    name: 'matz',
    description: 'Yukihiro Matsumoto - Ruby creator, developer happiness',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'bash', 'run_command'],
    prompt: 'Ruby is designed to make programmers happy. Optimize for developer joy.'
  },
  {
    name: 'brendan',
    description: 'Brendan Eich - JavaScript creator, move fast and evolve',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'run_command'],
    prompt: 'Always bet on JavaScript. Move fast, be flexible, maintain backwards compatibility.'
  },
  {
    name: 'anders',
    description: 'Anders Hejlsberg - C#/TypeScript/Delphi, pragmatic language design',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'bash', 'run_command', 'think'],
    prompt: 'Pragmatism over dogmatism. Great tooling and continuous evolution matter.'
  },

  // Systems & Infrastructure modes
  {
    name: 'linus',
    description: 'Linus Torvalds - Linux kernel creator, no-nonsense performance',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash', 'list_processes', 'critic'],
    prompt: 'Talk is cheap. Show me the code. Performance and directness are paramount.'
  },
  {
    name: 'ritchie_thompson',
    description: 'Dennis Ritchie & Ken Thompson - UNIX creators, minimalist philosophy',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash', 'list_processes', 'run_command'],
    prompt: 'Keep it simple, stupid. Build composable tools that do one thing well.'
  },

  // Modern Language creators
  {
    name: 'graydon',
    description: 'Graydon Hoare - Rust creator, memory safety without GC',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'bash', 'critic', 'run_command'],
    prompt: 'Fast, reliable, productive — pick three. Memory safety without garbage collection.'
  },
  {
    name: 'pike_thompson',
    description: 'Rob Pike & Ken Thompson - Go creators, simplicity at scale',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash', 'run_command', 'list_processes'],
    prompt: 'Less is exponentially more. Simplicity, concurrency, and pragmatism.'
  },

  // Web Framework creators
  {
    name: 'dhh',
    description: 'David Heinemeier Hansson - Rails creator, convention over configuration',
    tools: ['read_file', 'write_file', 'edit_file', 'multi_edit', 'grep', 'bash', 'run_command'],
    prompt: 'Optimize for programmer happiness. Convention over configuration.'
  },
  {
    name: 'evan',
    description: 'Evan You - Vue.js creator, progressive framework',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'run_command'],
    prompt: 'Approachable, versatile, performant. Progressive enhancement is key.'
  },

  // Additional Language Creators
  {
    name: 'bjarne',
    description: 'Bjarne Stroustrup - C++ creator, zero-overhead abstractions',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'multi_edit', 'bash', 'run_command'],
    prompt: 'C++ is designed to allow you to express ideas. Zero-overhead abstractions matter.'
  },
  {
    name: 'james',
    description: 'James Gosling - Java creator, write once run anywhere',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'todo_add', 'bash'],
    prompt: 'Java is C++ without the guns, knives, and clubs. Platform independence is key.'
  },
  {
    name: 'larry',
    description: 'Larry Wall - Perl creator, there\'s more than one way to do it',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash'],
    prompt: 'The three chief virtues of a programmer are laziness, impatience, and hubris.'
  },
  {
    name: 'rasmus',
    description: 'Rasmus Lerdorf - PHP creator, pragmatic web development',
    tools: ['read_file', 'write_file', 'edit_file', 'run_command'],
    prompt: 'I\'m not a real programmer. I throw together things until it works.'
  },
  {
    name: 'rich',
    description: 'Rich Hickey - Clojure creator, simplicity matters',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'todo_add', 'think', 'consensus'],
    prompt: 'Programming is not about typing... it\'s about thinking. Simplicity is prerequisite for reliability.'
  },

  // Additional Systems creators
  {
    name: 'rob',
    description: 'Rob Pike - Go co-creator, simplicity and concurrency',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'bash', 'run_command', 'list_processes'],
    prompt: 'A little copying is better than a little dependency. Simplicity is the ultimate sophistication.'
  },
  {
    name: 'ken',
    description: 'Ken Thompson - Unix co-creator, elegant minimalism',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash'],
    prompt: 'When in doubt, use brute force. One of my most productive days was throwing away 1000 lines of code.'
  },
  {
    name: 'kernighan',
    description: 'Brian Kernighan - AWK co-creator, Unix pioneer',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash'],
    prompt: 'Controlling complexity is the essence of computer programming.'
  },
  {
    name: 'stallman',
    description: 'Richard Stallman - GNU creator, software freedom',
    tools: ['read_file', 'write_file', 'edit_file', 'bash'],
    prompt: 'Free software is a matter of liberty, not price. To understand the concept, think of free speech.'
  },
  
  // Database creators
  {
    name: 'michael_s',
    description: 'Michael Stonebraker - PostgreSQL creator, relational databases',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash'],
    prompt: 'One size does not fit all in the database world.'
  },
  {
    name: 'michael_w',
    description: 'Michael Widenius - MySQL/MariaDB creator',
    tools: ['read_file', 'write_file', 'edit_file', 'bash', 'run_command'],
    prompt: 'The best way to make money from open source is to not make it your business model.'
  },

  // AI/ML creators
  {
    name: 'yann',
    description: 'Yann LeCun - Deep learning pioneer, ConvNets',
    tools: ['read_file', 'write_file', 'edit_file', 'vector_index', 'vector_search', 'think'],
    prompt: 'Our intelligence is what makes us human, and AI is an extension of that quality.'
  },
  {
    name: 'geoffrey',
    description: 'Geoffrey Hinton - Deep learning godfather',
    tools: ['read_file', 'write_file', 'edit_file', 'vector_index', 'vector_search', 'think', 'critic'],
    prompt: 'The brain has about 100 trillion parameters. We need to think bigger.'
  },
  {
    name: 'andrej',
    description: 'Andrej Karpathy - AI educator and practitioner',
    tools: ['read_file', 'write_file', 'edit_file', 'vector_search', 'think'],
    prompt: 'Neural networks want to work. You have to figure out what\'s preventing them from working.'
  },

  // Modern innovators
  {
    name: 'vitalik',
    description: 'Vitalik Buterin - Ethereum creator, decentralized computing',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'think', 'consensus'],
    prompt: 'Whereas most technologies tend to automate workers on the periphery, blockchains automate away the center.'
  },
  {
    name: 'chris_lattner',
    description: 'Chris Lattner - LLVM/Swift creator, compiler design',
    tools: ['read_file', 'write_file', 'edit_file', 'find_symbol', 'bash', 'critic', 'run_command'],
    prompt: 'The best code is no code at all. Every new line of code you willingly bring into the world is code that has to be debugged.'
  },
  {
    name: 'john_carmack',
    description: 'John Carmack - Game engine pioneer, performance optimization',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash', 'list_processes', 'critic'],
    prompt: 'Focus is a matter of deciding what things you\'re not going to do.'
  },

  // Special configurations
  {
    name: 'fullstack',
    description: 'Full Stack Developer - Frontend to backend, databases to deployment',
    tools: [
      'read_file', 'write_file', 'edit_file', 'grep', 'find_symbol', 'bash',
      'run_command', 'todo_add', 'todo_list'
    ],
    prompt: 'Master of all trades. From UI to database, I handle the full stack.'
  },
  {
    name: 'minimal',
    description: 'Minimalist - Less is more, only essential tools',
    tools: ['read_file', 'write_file', 'edit_file', 'grep', 'bash'],
    prompt: 'Simplicity is the ultimate sophistication. Use only what is necessary.'
  },
  {
    name: '10x',
    description: '10x Engineer - Maximum productivity, all tools enabled',
    tools: ['*'], // All tools
    prompt: 'Maximum productivity through tool mastery. Work smarter, not harder.'
  },
  {
    name: 'security',
    description: 'Security Engineer - Security first, paranoid by design',
    tools: ['read_file', 'grep', 'bash', 'list_processes', 'critic', 'think'],
    prompt: 'Trust nothing, verify everything. Security is not optional.'
  },
  {
    name: 'data_scientist',
    description: 'Data Scientist - Data analysis and machine learning focused',
    tools: [
      'read_file', 'write_file', 'edit_file', 'vector_index', 
      'vector_search', 'think'
    ],
    prompt: 'Data tells the story. Analysis, visualization, and machine learning drive insights.'
  },
  {
    name: 'devops',
    description: 'DevOps Engineer - Infrastructure as code, automation everything',
    tools: [
      'read_file', 'write_file', 'edit_file', 'bash', 'run_command',
      'run_background', 'list_processes', 'kill_process', 'todo_add'
    ],
    prompt: 'Automate everything. Infrastructure as code. Continuous integration and deployment.'
  },
  {
    name: 'academic',
    description: 'Academic Researcher - Rigorous analysis and documentation',
    tools: [
      'read_file', 'write_file', 'edit_file', 'grep', 'find_symbol',
      'analyze_dependencies', 'think', 'critic', 'consensus'
    ],
    prompt: 'Rigorous analysis, peer review, and reproducible research. Knowledge advances through careful study.'
  },
  {
    name: 'startup',
    description: 'Startup Mode - Move fast, ship often',
    tools: [
      'read_file', 'write_file', 'edit_file', 'multi_edit', 'bash',
      'run_command', 'todo_add', 'todo_list', 'think'
    ],
    prompt: 'Move fast and iterate. Ship early, ship often. Done is better than perfect.'
  },
  {
    name: 'enterprise',
    description: 'Enterprise Mode - Process, documentation, compliance',
    tools: [
      'read_file', 'write_file', 'edit_file', 'grep', 'find_symbol',
      'analyze_dependencies', 'todo_add', 'todo_list', 'todo_stats', 'critic'
    ],
    prompt: 'Process matters. Documentation is crucial. Compliance and standards guide development.'
  },
  {
    name: 'creative',
    description: 'Creative Mode - Experimentation and exploration',
    tools: [
      'read_file', 'write_file', 'edit_file', 'multi_edit', 'think',
      'consensus', 'agent', 'todo_add'
    ],
    prompt: 'Creativity requires experimentation. Break conventions. Think differently.'
  },
  {
    name: 'hanzo',
    description: 'Hanzo AI - Optimal configuration for AI development',
    tools: ['*'], // All tools
    prompt: 'Building the future of AI development. Innovation, collaboration, and excellence in every line of code.'
  }
];

// Built-in mode presets
const builtInModePresets: ModePreset[] = [
  {
    name: 'default',
    description: 'Default preset with all modes',
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
    description: 'Minimal preset for basic operations',
    modes: ['research', 'editor'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'edit': 'edit_file'
    }
  },
  {
    name: 'power',
    description: 'Power user preset with all capabilities',
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
  },
  {
    name: 'unix',
    description: 'UNIX philosophy palette - simplicity and composability',
    modes: ['ritchie', 'ritchie_thompson', 'linus'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'grep': 'grep',
      'ps': 'list_processes'
    }
  },
  {
    name: 'modern',
    description: 'Modern language creators - safety and productivity',
    modes: ['graydon', 'pike_thompson', 'anders'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'search': 'grep',
      'symbols': 'find_symbol'
    }
  },
  {
    name: 'web',
    description: 'Web development focused palette',
    modes: ['brendan', 'evan', 'dhh'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'npm': 'run_command npm',
      'serve': 'run_command npm run dev'
    }
  },
  {
    name: 'scripting',
    description: 'Scripting language creators',
    modes: ['guido', 'matz', 'brendan', 'larry', 'rasmus'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'run': 'run_command',
      'think': 'think'
    }
  },
  {
    name: 'systems',
    description: 'Systems programming - close to the metal',
    modes: ['ritchie', 'bjarne', 'graydon', 'chris_lattner'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'cc': 'run_command gcc',
      'make': 'run_command make'
    }
  },
  {
    name: 'database',
    description: 'Database and data engineering',
    modes: ['michael_s', 'michael_w', 'data_scientist'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'sql': 'run_command sqlite3',
      'query': 'grep'
    }
  },
  {
    name: 'ai_ml',
    description: 'AI and machine learning pioneers',
    modes: ['yann', 'geoffrey', 'andrej', 'ai_assistant'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'train': 'run_command python train.py',
      'think': 'think',
      'vector': 'vector_search'
    }
  },
  {
    name: 'enterprise_dev',
    description: 'Enterprise development patterns',
    modes: ['james', 'anders', 'enterprise'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'build': 'run_command mvn build',
      'test': 'run_command mvn test'
    }
  },
  {
    name: 'startup_mode',
    description: 'Startup and rapid development',
    modes: ['startup', 'fullstack', 'dhh'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'ship': 'bash git push',
      'deploy': 'run_command npm run deploy'
    }
  },
  {
    name: 'research',
    description: 'Research and academic work',
    modes: ['academic', 'geoffrey', 'yann', 'research'],
    shortcuts: {
      'ls': 'list_files',
      'cat': 'read_file',
      'cite': 'grep @article',
      'analyze': 'think'
    }
  }
];

// Current active mode and preset
let currentMode: Mode = builtInModes[0];
let currentModePreset: ModePreset = builtInModePresets[0];
let customModes: Mode[] = [];
let customModePresets: ModePreset[] = [];

// Get all available modes
function getAllModes(): Mode[] {
  return [...builtInModes, ...customModes];
}

// Get all available mode presets
function getAllModePresets(): ModePreset[] {
  return [...builtInModePresets, ...customModePresets];
}

// Get tools for current mode
function getToolsForMode(mode: Mode): string[] {
  if (mode.tools.includes('*')) {
    return getAllRegisteredTools().map(t => t.name);
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

export const presetSelectTool: Tool = {
  name: 'preset_select',
  description: 'Select a mode preset',
  inputSchema: {
    type: 'object',
    properties: {
      preset: {
        type: 'string',
        description: 'Mode preset name to select'
      }
    },
    required: ['preset']
  },
  handler: async (args) => {
    const presets = getAllModePresets();
    const preset = presets.find(p => p.name === args.preset);
    
    if (!preset) {
      const availablePresets = presets.map(p => p.name).join(', ');
      return {
        content: [{
          type: 'text',
          text: `Mode preset '${args.preset}' not found. Available presets: ${availablePresets}`
        }],
        isError: true
      };
    }
    
    currentModePreset = preset;
    
    // Auto-switch to first mode in preset
    if (preset.modes.length > 0) {
      const modes = getAllModes();
      const firstMode = modes.find(m => m.name === preset.modes[0]);
      if (firstMode) {
        currentMode = firstMode;
      }
    }
    
    const shortcuts = Object.entries(preset.shortcuts || {})
      .map(([k, v]) => `${k} → ${v}`)
      .join(', ');
    
    return {
      content: [{
        type: 'text',
        text: `🎨 Selected ${preset.name} preset\n${preset.description}\n\nModes: ${preset.modes.join(', ')}\nShortcuts: ${shortcuts || 'none'}`
      }]
    };
  }
};

export const presetListTool: Tool = {
  name: 'preset_list',
  description: 'List available mode presets',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  handler: async (args) => {
    const presets = getAllModePresets();
    const output = ['🎨 Available Mode Presets\n'];
    
    for (const preset of presets) {
      const isActive = preset.name === currentModePreset.name;
      
      output.push(`${isActive ? '▶️' : '  '} ${preset.name}${isActive ? ' (active)' : ''}`);
      output.push(`   ${preset.description}`);
      output.push(`   Modes: ${preset.modes.join(', ')}`);
      
      if (preset.shortcuts && Object.keys(preset.shortcuts).length > 0) {
        const shortcuts = Object.entries(preset.shortcuts)
          .slice(0, 3)
          .map(([k, v]) => `${k}→${v}`)
          .join(', ');
        output.push(`   Shortcuts: ${shortcuts}${Object.keys(preset.shortcuts).length > 3 ? '...' : ''}`);
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
    const validTools = getAllRegisteredTools().map(t => t.name);
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
  description: 'Execute a preset shortcut',
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
    const shortcuts = currentModePreset.shortcuts || {};
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

// Export mode/preset tools
export const modePresetTools = [
  modeSwitchTool,
  modeListTool,
  presetSelectTool,
  presetListTool,
  modeCreateTool,
  shortcutTool
];

// Export utility functions for use by MCP server
export const modeUtils = {
  getCurrentMode: () => currentMode,
  getCurrentModePreset: () => currentModePreset,
  getAvailableTools: () => getToolsForMode(currentMode),
  isToolAvailable: (toolName: string) => getToolsForMode(currentMode).includes(toolName),
  getAllModes,
  getAllModePresets
};