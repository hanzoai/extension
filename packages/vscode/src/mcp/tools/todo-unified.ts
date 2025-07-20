import * as vscode from 'vscode';
import { MCPTool } from '../server';

interface TodoItem {
    id: string;
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'high' | 'medium' | 'low';
    createdAt: Date;
    updatedAt: Date;
}

export function createUnifiedTodoTool(context: vscode.ExtensionContext): MCPTool {
    const TODO_KEY = 'hanzo.todos';

    const getTodos = (): TodoItem[] => {
        const stored = context.globalState.get<string>(TODO_KEY);
        if (!stored) return [];
        
        try {
            const parsed = JSON.parse(stored);
            return parsed.map((item: any) => ({
                ...item,
                createdAt: new Date(item.createdAt),
                updatedAt: new Date(item.updatedAt)
            }));
        } catch {
            return [];
        }
    };

    const saveTodos = (todos: TodoItem[]) => {
        context.globalState.update(TODO_KEY, JSON.stringify(todos));
    };

    return {
        name: 'todo',
        description: 'Unified todo management',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: ['read', 'write', 'add', 'update', 'delete', 'clear'],
                    description: 'Action to perform'
                },
                tasks: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            content: { type: 'string' },
                            status: { 
                                type: 'string',
                                enum: ['pending', 'in_progress', 'completed']
                            },
                            priority: {
                                type: 'string',
                                enum: ['high', 'medium', 'low']
                            }
                        }
                    },
                    description: 'Tasks to add/update'
                },
                task: {
                    type: 'string',
                    description: 'Single task content (for add action)'
                },
                id: {
                    type: 'string',
                    description: 'Task ID (for update/delete actions)'
                },
                status: {
                    type: 'string',
                    enum: ['all', 'pending', 'in_progress', 'completed'],
                    description: 'Filter by status (for read action)'
                },
                priority: {
                    type: 'string',
                    enum: ['all', 'high', 'medium', 'low'],
                    description: 'Filter by priority'
                }
            },
            required: ['action']
        },
        handler: async (args: {
            action: string;
            tasks?: any[];
            task?: string;
            id?: string;
            status?: string;
            priority?: string;
        }) => {
            switch (args.action) {
                case 'read': {
                    const todos = getTodos();
                    let filtered = todos;
                    
                    if (args.status && args.status !== 'all') {
                        filtered = filtered.filter(t => t.status === args.status);
                    }
                    if (args.priority && args.priority !== 'all') {
                        filtered = filtered.filter(t => t.priority === args.priority);
                    }

                    if (filtered.length === 0) {
                        return 'No todos found';
                    }

                    const formatTodo = (todo: TodoItem) => {
                        const statusEmoji = {
                            pending: '⏳',
                            in_progress: '🔄',
                            completed: '✅'
                        };
                        const priorityEmoji = {
                            high: '🔴',
                            medium: '🟡',
                            low: '🟢'
                        };
                        
                        return `${statusEmoji[todo.status]} [${todo.id}] ${priorityEmoji[todo.priority]} ${todo.content}`;
                    };

                    const grouped = {
                        in_progress: filtered.filter(t => t.status === 'in_progress'),
                        pending: filtered.filter(t => t.status === 'pending'),
                        completed: filtered.filter(t => t.status === 'completed')
                    };

                    const sections: string[] = [];
                    
                    if (grouped.in_progress.length > 0) {
                        sections.push('=== In Progress ===\n' + grouped.in_progress.map(formatTodo).join('\n'));
                    }
                    if (grouped.pending.length > 0) {
                        sections.push('=== Pending ===\n' + grouped.pending.map(formatTodo).join('\n'));
                    }
                    if (grouped.completed.length > 0) {
                        sections.push('=== Completed ===\n' + grouped.completed.map(formatTodo).join('\n'));
                    }

                    return sections.join('\n\n');
                }
                
                case 'add': {
                    const todos = getTodos();
                    
                    if (args.task) {
                        // Simple add
                        const newTodo: TodoItem = {
                            id: `${Date.now()}`,
                            content: args.task,
                            status: 'pending',
                            priority: 'medium',
                            createdAt: new Date(),
                            updatedAt: new Date()
                        };
                        todos.push(newTodo);
                        saveTodos(todos);
                        return `Added todo: ${newTodo.content} (ID: ${newTodo.id})`;
                    }
                    
                    return 'Error: Task content required for add action';
                }
                
                case 'write': {
                    // Legacy support for batch operations
                    if (!args.tasks || !Array.isArray(args.tasks)) {
                        return 'Error: Tasks array required for write action';
                    }
                    
                    const todos = getTodos();
                    let added = 0, updated = 0;
                    
                    for (const task of args.tasks) {
                        const existing = todos.find(t => t.id === task.id);
                        if (existing) {
                            // Update
                            if (task.content !== undefined) existing.content = task.content;
                            if (task.status !== undefined) existing.status = task.status;
                            if (task.priority !== undefined) existing.priority = task.priority;
                            existing.updatedAt = new Date();
                            updated++;
                        } else {
                            // Add
                            todos.push({
                                id: task.id || `${Date.now()}-${Math.random()}`,
                                content: task.content || '',
                                status: task.status || 'pending',
                                priority: task.priority || 'medium',
                                createdAt: new Date(),
                                updatedAt: new Date()
                            });
                            added++;
                        }
                    }
                    
                    saveTodos(todos);
                    return `Todo list updated: ${added} added, ${updated} updated`;
                }
                
                case 'update': {
                    if (!args.id) {
                        return 'Error: ID required for update action';
                    }
                    
                    const todos = getTodos();
                    const todo = todos.find(t => t.id === args.id);
                    
                    if (!todo) {
                        return `Error: Todo ${args.id} not found`;
                    }
                    
                    if (args.status) todo.status = args.status as any;
                    if (args.priority) todo.priority = args.priority as any;
                    if (args.task) todo.content = args.task;
                    todo.updatedAt = new Date();
                    
                    saveTodos(todos);
                    return `Updated todo ${args.id}`;
                }
                
                case 'delete': {
                    if (!args.id) {
                        return 'Error: ID required for delete action';
                    }
                    
                    const todos = getTodos();
                    const index = todos.findIndex(t => t.id === args.id);
                    
                    if (index === -1) {
                        return `Error: Todo ${args.id} not found`;
                    }
                    
                    const deleted = todos.splice(index, 1)[0];
                    saveTodos(todos);
                    return `Deleted todo: ${deleted.content}`;
                }
                
                case 'clear': {
                    const todos = getTodos();
                    const completed = todos.filter(t => t.status === 'completed');
                    const remaining = todos.filter(t => t.status !== 'completed');
                    
                    saveTodos(remaining);
                    return `Cleared ${completed.length} completed todos`;
                }
                
                default:
                    return `Error: Unknown action '${args.action}'`;
            }
        }
    };
}