import * as vscode from 'vscode';
import { MCPTool } from '../server';
import { TodoItem } from '../../types/common';
import { StorageUtil } from '../../utils/storage';

export function createTodoTools(context: vscode.ExtensionContext): MCPTool[] {
    const TODO_KEY = 'hanzo.todos';

    const getTodos = async (): Promise<TodoItem[]> => {
        const todos = await StorageUtil.retrieveGlobal<TodoItem[]>(context, TODO_KEY, []);
        // Convert date strings back to Date objects if needed
        return todos.map((item: any) => ({
            ...item,
            created: item.created || item.createdAt,
            updated: item.updated || item.updatedAt
        }));
    };

    const saveTodos = async (todos: TodoItem[]) => {
        await StorageUtil.storeGlobal(context, TODO_KEY, todos);
    };

    return [
        {
            name: 'todo_read',
            description: 'Read the current todo list',
            inputSchema: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['all', 'pending', 'in_progress', 'completed'],
                        description: 'Filter by status (default: all)'
                    },
                    priority: {
                        type: 'string',
                        enum: ['all', 'high', 'medium', 'low'],
                        description: 'Filter by priority (default: all)'
                    }
                }
            },
            handler: async (args: { status?: string; priority?: string }) => {
                const todos = await getTodos();
                
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

                // Group by status
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
        },

        {
            name: 'todo_write',
            description: 'Create or update todo items',
            inputSchema: {
                type: 'object',
                properties: {
                    todos: {
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
                            },
                            required: ['content', 'status', 'priority']
                        },
                        description: 'Array of todo items to create or update'
                    },
                    action: {
                        type: 'string',
                        enum: ['replace', 'merge', 'append'],
                        description: 'How to handle the todo list (default: replace)'
                    }
                },
                required: ['todos']
            },
            handler: async (args: { 
                todos: Array<{
                    id?: string;
                    content: string;
                    status: 'pending' | 'in_progress' | 'completed';
                    priority: 'high' | 'medium' | 'low';
                }>;
                action?: string;
            }) => {
                const action = args.action || 'replace';
                let todos = await getTodos();
                
                if (action === 'replace') {
                    // Replace entire list
                    todos = args.todos.map((item, index) => ({
                        id: item.id || `${Date.now()}-${index}`,
                        content: item.content,
                        status: item.status,
                        priority: item.priority,
                        created: Date.now(),
                        updated: Date.now()
                    }));
                } else if (action === 'merge') {
                    // Update existing, add new
                    for (const item of args.todos) {
                        const existing = todos.find(t => t.id === item.id);
                        if (existing) {
                            existing.content = item.content;
                            existing.status = item.status;
                            existing.priority = item.priority;
                            existing.updated = Date.now();
                        } else {
                            todos.push({
                                id: item.id || `${Date.now()}-${Math.random()}`,
                                content: item.content,
                                status: item.status,
                                priority: item.priority,
                                created: Date.now(),
                                updated: Date.now()
                            });
                        }
                    }
                } else if (action === 'append') {
                    // Add new items only
                    const newTodos = args.todos.map((item, index) => ({
                        id: item.id || `${Date.now()}-${index}`,
                        content: item.content,
                        status: item.status,
                        priority: item.priority,
                        created: Date.now(),
                        updated: Date.now()
                    }));
                    todos.push(...newTodos);
                }

                await saveTodos(todos);
                
                // Return summary
                const summary = {
                    total: todos.length,
                    pending: todos.filter(t => t.status === 'pending').length,
                    in_progress: todos.filter(t => t.status === 'in_progress').length,
                    completed: todos.filter(t => t.status === 'completed').length
                };
                
                return `Todo list updated: ${summary.total} total (${summary.pending} pending, ${summary.in_progress} in progress, ${summary.completed} completed)`;
            }
        }
    ];
}