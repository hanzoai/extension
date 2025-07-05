import * as vscode from 'vscode';
import { MCPTool } from '../server';

interface DevelopmentMode {
    name: string;
    programmer: string;
    description: string;
    philosophy?: string;
    tools: string[];
    environment?: Record<string, string>;
    config?: Record<string, any>;
}

const DEVELOPMENT_MODES: Record<string, DevelopmentMode> = {
    // Language Creators - Original Languages
    'ritchie': {
        name: 'ritchie',
        programmer: 'Dennis Ritchie',
        description: 'C creator - UNIX philosophy',
        philosophy: 'UNIX: Do one thing and do it well',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'run_command'],
        config: { simplicity: 10, portability: 10, efficiency: 10 }
    },
    'bjarne': {
        name: 'bjarne',
        programmer: 'Bjarne Stroustrup',
        description: 'C++ creator - zero-overhead abstraction',
        philosophy: 'C++: Light-weight abstraction',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'critic'],
        config: { abstraction: 9, performance: 10, compatibility: 8 }
    },
    'gosling': {
        name: 'gosling',
        programmer: 'James Gosling',
        description: 'Java creator - write once, run anywhere',
        philosophy: 'Java: Platform independence',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'critic', 'think'],
        config: { portability: 10, safety: 9, verbosity: 7 }
    },
    'guido': {
        name: 'guido',
        programmer: 'Guido van Rossum',
        description: 'Python creator - readability counts',
        philosophy: 'There should be one-- and preferably only one --obvious way to do it',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'uvx', 'think', 'notebook_read', 'notebook_edit'],
        config: { readability: 10, simplicity: 9, explicitness: 10 }
    },
    'matz': {
        name: 'matz',
        programmer: 'Yukihiro Matsumoto',
        description: 'Ruby creator - developer happiness',
        philosophy: 'Ruby is designed to make programmers happy',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'run_command'],
        config: { happiness: 10, expressiveness: 10, principle_of_least_surprise: 9 }
    },
    'wall': {
        name: 'wall',
        programmer: 'Larry Wall',
        description: 'Perl creator - TMTOWTDI',
        philosophy: "There's More Than One Way To Do It",
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'run_command', 'content_replace'],
        config: { flexibility: 10, expressiveness: 10, readability: 5 }
    },
    'rasmus': {
        name: 'rasmus',
        programmer: 'Rasmus Lerdorf',
        description: 'PHP creator - pragmatic web development',
        philosophy: 'PHP: Solving web problems pragmatically',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'run_command', 'web_fetch'],
        config: { pragmatism: 10, web_focus: 10, consistency: 6 }
    },
    'brendan': {
        name: 'brendan',
        programmer: 'Brendan Eich',
        description: 'JavaScript creator - move fast and evolve',
        philosophy: 'Always bet on JavaScript',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'npx', 'web_fetch', 'run_command'],
        config: { speed: 10, flexibility: 9, backwards_compatibility: 8 }
    },
    'anders': {
        name: 'anders',
        programmer: 'Anders Hejlsberg',
        description: 'C#/TypeScript/Delphi - pragmatic language design',
        philosophy: 'Pragmatism over dogmatism',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'run_command', 'think'],
        config: { pragmatism: 10, tooling: 10, evolution: 9 }
    },
    'wirth': {
        name: 'wirth',
        programmer: 'Niklaus Wirth',
        description: 'Pascal creator - structured programming',
        philosophy: 'Algorithms + Data Structures = Programs',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'think'],
        config: { structure: 10, clarity: 10, simplicity: 9 }
    },
    'mccarthy': {
        name: 'mccarthy',
        programmer: 'John McCarthy',
        description: 'Lisp creator - code as data',
        philosophy: 'Lisp: The programmable programming language',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'think', 'critic'],
        config: { homoiconicity: 10, flexibility: 10, parentheses: 10 }
    },
    'hickey': {
        name: 'hickey',
        programmer: 'Rich Hickey',
        description: 'Clojure creator - simplicity matters',
        philosophy: 'Simple Made Easy',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'think', 'critic'],
        config: { simplicity: 10, immutability: 10, expressiveness: 9 }
    },
    'armstrong': {
        name: 'armstrong',
        programmer: 'Joe Armstrong',
        description: 'Erlang creator - let it crash',
        philosophy: 'Let it crash and recover',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'processes', 'run_background'],
        config: { fault_tolerance: 10, concurrency: 10, distribution: 9 }
    },
    'odersky': {
        name: 'odersky',
        programmer: 'Martin Odersky',
        description: 'Scala creator - scalable language',
        philosophy: 'Fusion of functional and object-oriented programming',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'think'],
        config: { scalability: 10, expressiveness: 9, type_safety: 10 }
    },
    'lattner': {
        name: 'lattner',
        programmer: 'Chris Lattner',
        description: 'Swift/LLVM creator - performance with safety',
        philosophy: 'Performance and safety without compromise',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'critic'],
        config: { safety: 10, performance: 10, expressiveness: 8 }
    },
    'bak': {
        name: 'bak',
        programmer: 'Lars Bak',
        description: 'Dart/V8 creator - structured web programming',
        philosophy: 'Fast development and execution',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'web_fetch'],
        config: { performance: 10, structure: 9, tooling: 10 }
    },
    'backus': {
        name: 'backus',
        programmer: 'John Backus',
        description: 'Fortran creator - scientific computing',
        philosophy: 'Formula Translation for scientists',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'run_command'],
        config: { performance: 10, scientific_computing: 10, legacy: 10 }
    },
    'hopper': {
        name: 'hopper',
        programmer: 'Grace Hopper',
        description: 'COBOL creator - business language',
        philosophy: 'Programming for everyone',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'think'],
        config: { readability: 9, business_focus: 10, verbosity: 8 }
    },
    'kay': {
        name: 'kay',
        programmer: 'Alan Kay',
        description: 'Smalltalk creator - OOP pioneer',
        philosophy: 'The best way to predict the future is to invent it',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'think', 'critic'],
        config: { object_orientation: 10, messaging: 10, simplicity: 9 }
    },

    // Systems & Infrastructure
    'linus': {
        name: 'linus',
        programmer: 'Linus Torvalds',
        description: 'Linux kernel creator - no-nonsense performance',
        philosophy: 'Talk is cheap. Show me the code.',
        tools: ['read', 'write', 'edit', 'grep', 'git_search', 'bash', 'processes', 'critic'],
        config: { performance: 10, directness: 10, patience: 2 }
    },
    'ritchie_thompson': {
        name: 'ritchie_thompson',
        programmer: 'Dennis Ritchie & Ken Thompson',
        description: 'UNIX creators - minimalist philosophy',
        philosophy: 'Keep it simple, stupid',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'processes', 'run_command'],
        config: { minimalism: 10, composability: 10, elegance: 10 }
    },

    // Web Frameworks
    'dhh': {
        name: 'dhh',
        programmer: 'David Heinemeier Hansson',
        description: 'Ruby on Rails creator - convention over configuration',
        philosophy: 'Optimize for programmer happiness',
        tools: ['read', 'write', 'edit', 'multi_edit', 'grep', 'bash', 'run_command', 'sql_query'],
        config: { productivity: 10, conventions: 10, opinionated: 10 }
    },
    'evan': {
        name: 'evan',
        programmer: 'Evan You',
        description: 'Vue.js creator - progressive framework',
        philosophy: 'Approachable, versatile, performant',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'web_fetch', 'run_command'],
        config: { approachability: 10, flexibility: 9, performance: 8 }
    },
    'walke': {
        name: 'walke',
        programmer: 'Jordan Walke',
        description: 'React creator - declarative UI',
        philosophy: 'UI as a function of state',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'web_fetch', 'symbols'],
        config: { declarative: 10, component_based: 10, virtual_dom: 9 }
    },
    'otwell': {
        name: 'otwell',
        programmer: 'Taylor Otwell',
        description: 'Laravel creator - PHP elegance',
        philosophy: 'The PHP framework for web artisans',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'sql_query', 'run_command'],
        config: { elegance: 10, expressiveness: 9, developer_experience: 10 }
    },
    'holovaty_willison': {
        name: 'holovaty_willison',
        programmer: 'Adrian Holovaty & Simon Willison',
        description: 'Django creators - web framework for perfectionists',
        philosophy: 'The web framework for perfectionists with deadlines',
        tools: ['read', 'write', 'edit', 'grep', 'uvx', 'sql_query', 'run_command'],
        config: { batteries_included: 10, security: 10, rapid_development: 9 }
    },
    'ronacher': {
        name: 'ronacher',
        programmer: 'Armin Ronacher',
        description: 'Flask/Jinja creator - micro framework',
        philosophy: 'Web development, one drop at a time',
        tools: ['read', 'write', 'edit', 'grep', 'uvx', 'run_command'],
        config: { minimalism: 10, flexibility: 10, extensibility: 9 }
    },
    'holowaychuk': {
        name: 'holowaychuk',
        programmer: 'TJ Holowaychuk',
        description: 'Express.js creator - minimalist web framework',
        philosophy: 'Fast, unopinionated, minimalist',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'run_command'],
        config: { minimalism: 10, middleware: 10, flexibility: 9 }
    },

    // JavaScript Ecosystem
    'katz': {
        name: 'katz',
        programmer: 'Yehuda Katz',
        description: 'Ember.js creator - ambitious web apps',
        philosophy: 'Convention over Configuration',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'run_command', 'symbols'],
        config: { conventions: 10, productivity: 9, stability: 10 }
    },
    'ashkenas': {
        name: 'ashkenas',
        programmer: 'Jeremy Ashkenas',
        description: 'CoffeeScript/Backbone creator - JavaScript, the good parts',
        philosophy: 'It\'s just JavaScript',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'run_command'],
        config: { elegance: 10, simplicity: 9, readability: 8 }
    },
    'nolen': {
        name: 'nolen',
        programmer: 'David Nolen',
        description: 'ClojureScript lead - functional web development',
        philosophy: 'Functional programming for the web',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'symbols', 'think'],
        config: { functional: 10, immutability: 10, performance: 9 }
    },

    // Modern Languages
    'graydon': {
        name: 'graydon',
        programmer: 'Graydon Hoare',
        description: 'Rust creator - memory safety without GC',
        philosophy: 'Fast, reliable, productive — pick three',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'critic', 'run_command'],
        config: { safety: 10, performance: 10, concurrency: 9 }
    },
    'pike_thompson': {
        name: 'pike_thompson',
        programmer: 'Rob Pike & Ken Thompson',
        description: 'Go creators - simplicity at scale',
        philosophy: 'Less is exponentially more',
        tools: ['read', 'write', 'edit', 'grep', 'bash', 'run_command', 'processes'],
        config: { simplicity: 10, concurrency: 10, pragmatism: 9 }
    },

    // Database & Infrastructure
    'widenius': {
        name: 'widenius',
        programmer: 'Michael Widenius',
        description: 'MySQL/MariaDB creator - open source database',
        philosophy: 'Open source database for everyone',
        tools: ['read', 'write', 'edit', 'sql_query', 'bash', 'run_command'],
        config: { openness: 10, performance: 9, compatibility: 8 }
    },

    // CSS & Design
    'wathan': {
        name: 'wathan',
        programmer: 'Adam Wathan',
        description: 'Tailwind CSS creator - utility-first CSS',
        philosophy: 'Stop writing CSS, start building designs',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'web_fetch'],
        config: { utility_first: 10, customization: 9, productivity: 10 }
    },
    'otto_thornton': {
        name: 'otto_thornton',
        programmer: 'Mark Otto & Jacob Thornton',
        description: 'Bootstrap creators - responsive web design',
        philosophy: 'Build responsive, mobile-first projects',
        tools: ['read', 'write', 'edit', 'grep', 'npx', 'web_fetch'],
        config: { responsiveness: 10, components: 9, consistency: 10 }
    },

    // Special Configurations
    'fullstack': {
        name: 'fullstack',
        programmer: 'Full Stack Developer',
        description: 'Frontend to backend, databases to deployment',
        tools: ['read', 'write', 'edit', 'grep', 'symbols', 'bash', 'npx', 'uvx', 
                'sql_query', 'web_fetch', 'todo', 'git_search'],
        config: { versatility: 10, breadth: 9, depth: 7 }
    },
    'minimal': {
        name: 'minimal',
        programmer: 'Minimalist',
        description: 'Less is more - only essential tools',
        tools: ['read', 'write', 'edit', 'grep', 'bash'],
        config: { simplicity: 10, focus: 10, feature_creep: 0 }
    },
    '10x': {
        name: '10x',
        programmer: '10x Engineer',
        description: 'Maximum productivity, all tools enabled',
        tools: ['read', 'write', 'edit', 'multi_edit', 'grep', 'symbols', 'git_search',
                'bash', 'npx', 'uvx', 'batch', 'agent', 'llm', 'consensus', 'think', 'critic'],
        config: { productivity: 10, tool_mastery: 10, work_life_balance: 3 }
    },
    'security': {
        name: 'security',
        programmer: 'Security Engineer',
        description: 'Security first, paranoid by design',
        tools: ['read', 'grep', 'git_search', 'bash', 'processes', 'critic', 'think'],
        config: { paranoia: 10, validation: 10, trust: 0 }
    },
    'data_scientist': {
        name: 'data_scientist',
        programmer: 'Data Scientist',
        description: 'Data analysis and machine learning focused',
        tools: ['read', 'write', 'edit', 'notebook_read', 'notebook_edit', 'uvx', 
                'sql_query', 'vector_search', 'think'],
        config: { analysis: 10, visualization: 8, statistics: 9 }
    },
    'hanzo': {
        name: 'hanzo',
        programmer: 'Hanzo AI',
        description: 'Hanzo AI optimal configuration',
        philosophy: 'Building the future of AI development',
        tools: ['read', 'write', 'edit', 'multi_edit', 'grep', 'symbols', 'git_search',
                'bash', 'npx', 'uvx', 'batch', 'agent', 'llm', 'consensus', 'think', 
                'critic', 'todo', 'sql_query', 'vector_search', 'web_fetch'],
        config: { innovation: 10, collaboration: 9, excellence: 10 }
    }
};

export function createModeTool(context: vscode.ExtensionContext): MCPTool {
    // Load current mode from context
    const getCurrentMode = () => {
        return context.globalState.get<string>('hanzo.developmentMode', 'fullstack');
    };
    
    const setCurrentMode = async (modeName: string) => {
        await context.globalState.update('hanzo.developmentMode', modeName);
        // Also update enabled tools based on mode
        const mode = DEVELOPMENT_MODES[modeName];
        if (mode) {
            const config = vscode.workspace.getConfiguration('hanzo.mcp');
            await config.update('enabledTools', mode.tools, true);
        }
    };
    
    return {
        name: 'mode',
        description: 'Manage development modes (programmer personalities)',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['list', 'activate', 'show', 'current'],
                    description: 'Action to perform (default: list)'
                },
                name: {
                    type: 'string',
                    description: 'Mode name (for activate/show actions)'
                }
            }
        },
        handler: async (args: { action?: string; name?: string }) => {
            const action = args.action || 'list';
            
            switch (action) {
                case 'list': {
                    const currentMode = getCurrentMode();
                    let output = 'Available development modes:\n\n';
                    
                    // Group modes by category
                    const categories = {
                        'Language Creators': [
                            'ritchie', 'bjarne', 'gosling', 'guido', 'matz', 'wall', 
                            'rasmus', 'brendan', 'anders', 'wirth', 'mccarthy', 'hickey',
                            'armstrong', 'odersky', 'lattner', 'bak', 'backus', 'hopper', 'kay'
                        ],
                        'Systems & Infrastructure': ['linus', 'ritchie_thompson'],
                        'Web Frameworks': [
                            'dhh', 'evan', 'walke', 'otwell', 'holovaty_willison', 
                            'ronacher', 'holowaychuk'
                        ],
                        'JavaScript Ecosystem': ['katz', 'ashkenas', 'nolen'],
                        'Modern Languages': ['graydon', 'pike_thompson'],
                        'Database & Infrastructure': ['widenius'],
                        'CSS & Design': ['wathan', 'otto_thornton'],
                        'Special Configurations': [
                            'fullstack', 'minimal', '10x', 'security', 
                            'data_scientist', 'hanzo'
                        ]
                    };
                    
                    for (const [category, modeNames] of Object.entries(categories)) {
                        output += `**${category}**:\n`;
                        for (const modeName of modeNames) {
                            const mode = DEVELOPMENT_MODES[modeName];
                            if (mode) {
                                const marker = currentMode === modeName ? ' *(active)*' : '';
                                output += `- **${mode.name}**${marker}: ${mode.programmer} - ${mode.description}\n`;
                            }
                        }
                        output += '\n';
                    }
                    
                    output += `\nCurrent mode: **${currentMode}**\n`;
                    output += "\nUse 'mode --action activate --name <mode>' to activate a mode";
                    
                    return output;
                }
                
                case 'activate': {
                    if (!args.name) {
                        throw new Error('Mode name required for activate action');
                    }
                    
                    const mode = DEVELOPMENT_MODES[args.name];
                    if (!mode) {
                        throw new Error(`Unknown mode: ${args.name}`);
                    }
                    
                    await setCurrentMode(args.name);
                    
                    let output = `Activated mode: **${mode.name}**\n`;
                    output += `Programmer: ${mode.programmer}\n`;
                    output += `Description: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `Philosophy: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `\nEnabled tools (${mode.tools.length}):\n`;
                    output += mode.tools.map(t => `- ${t}`).join('\n');
                    
                    if (mode.environment) {
                        output += '\n\nEnvironment variables:\n';
                        for (const [key, value] of Object.entries(mode.environment)) {
                            output += `- ${key}=${value}\n`;
                        }
                    }
                    
                    output += '\n\n*Note: Tool configuration has been updated. Restart the MCP session for full effect.*';
                    
                    return output;
                }
                
                case 'show': {
                    if (!args.name) {
                        throw new Error('Mode name required for show action');
                    }
                    
                    const mode = DEVELOPMENT_MODES[args.name];
                    if (!mode) {
                        throw new Error(`Unknown mode: ${args.name}`);
                    }
                    
                    let output = `## Mode: ${mode.name}\n\n`;
                    output += `**Programmer**: ${mode.programmer}\n`;
                    output += `**Description**: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `**Philosophy**: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `\n### Tools (${mode.tools.length})\n`;
                    output += mode.tools.map(t => `- ${t}`).join('\n');
                    
                    if (mode.config) {
                        output += '\n\n### Configuration\n';
                        for (const [key, value] of Object.entries(mode.config)) {
                            output += `- ${key}: ${value}/10\n`;
                        }
                    }
                    
                    if (mode.environment) {
                        output += '\n\n### Environment\n';
                        for (const [key, value] of Object.entries(mode.environment)) {
                            output += `- ${key}=${value}\n`;
                        }
                    }
                    
                    return output;
                }
                
                case 'current': {
                    const currentModeName = getCurrentMode();
                    const mode = DEVELOPMENT_MODES[currentModeName];
                    
                    if (!mode) {
                        return `Current mode: ${currentModeName} (custom mode)`;
                    }
                    
                    let output = `Current mode: **${mode.name}**\n`;
                    output += `Programmer: ${mode.programmer}\n`;
                    output += `Description: ${mode.description}\n`;
                    
                    if (mode.philosophy) {
                        output += `Philosophy: *"${mode.philosophy}"*\n`;
                    }
                    
                    output += `Enabled tools: ${mode.tools.length}`;
                    
                    return output;
                }
                
                default:
                    throw new Error(`Unknown action: ${action}. Use 'list', 'activate', 'show', or 'current'`);
            }
        }
    };
}