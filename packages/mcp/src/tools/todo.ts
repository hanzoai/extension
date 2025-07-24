/**
 * Todo management tools for task tracking
 */

import { Tool, ToolResult } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  created: string;
  updated: string;
  due?: string;
  tags?: string[];
  project?: string;
}

interface TodoList {
  items: TodoItem[];
  lastId: number;
}

// Default todo file location
const getTodoFilePath = () => {
  const todoPath = process.env.HANZO_TODO_PATH || path.join(os.homedir(), '.hanzo', 'todos.json');
  return todoPath;
};

// Load todos from file
async function loadTodos(): Promise<TodoList> {
  const todoPath = getTodoFilePath();
  
  try {
    const data = await fs.readFile(todoPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist, create default structure
    return { items: [], lastId: 0 };
  }
}

// Save todos to file
async function saveTodos(todos: TodoList): Promise<void> {
  const todoPath = getTodoFilePath();
  const dir = path.dirname(todoPath);
  
  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });
  
  // Save with pretty formatting
  await fs.writeFile(todoPath, JSON.stringify(todos, null, 2));
}

export const todoAddTool: Tool = {
  name: 'todo_add',
  description: 'Add a new todo item',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Todo description'
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Priority level',
        default: 'medium'
      },
      due: {
        type: 'string',
        description: 'Due date (ISO format)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization'
      },
      project: {
        type: 'string',
        description: 'Project name'
      }
    },
    required: ['content']
  },
  handler: async (args) => {
    try {
      const todos = await loadTodos();
      
      const newTodo: TodoItem = {
        id: (todos.lastId + 1).toString(),
        content: args.content,
        status: 'pending',
        priority: args.priority || 'medium',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        due: args.due,
        tags: args.tags,
        project: args.project
      };
      
      todos.items.push(newTodo);
      todos.lastId += 1;
      
      await saveTodos(todos);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Added todo #${newTodo.id}: ${newTodo.content}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error adding todo: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const todoListTool: Tool = {
  name: 'todo_list',
  description: 'List todo items',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['all', 'pending', 'in_progress', 'completed', 'cancelled'],
        description: 'Filter by status',
        default: 'all'
      },
      priority: {
        type: 'string',
        enum: ['all', 'high', 'medium', 'low'],
        description: 'Filter by priority',
        default: 'all'
      },
      project: {
        type: 'string',
        description: 'Filter by project'
      },
      tag: {
        type: 'string',
        description: 'Filter by tag'
      },
      limit: {
        type: 'number',
        description: 'Maximum items to show',
        default: 50
      }
    }
  },
  handler: async (args) => {
    try {
      const todos = await loadTodos();
      
      // Filter todos
      let filtered = todos.items;
      
      if (args.status && args.status !== 'all') {
        filtered = filtered.filter(t => t.status === args.status);
      }
      
      if (args.priority && args.priority !== 'all') {
        filtered = filtered.filter(t => t.priority === args.priority);
      }
      
      if (args.project) {
        filtered = filtered.filter(t => t.project === args.project);
      }
      
      if (args.tag) {
        filtered = filtered.filter(t => t.tags?.includes(args.tag));
      }
      
      // Sort by priority and status
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const statusOrder = { in_progress: 0, pending: 1, completed: 2, cancelled: 3 };
      
      filtered.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      });
      
      // Limit results
      const limited = filtered.slice(0, args.limit || 50);
      
      // Format output
      if (limited.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No todos found'
          }]
        };
      }
      
      const output = ['📋 Todo List\n'];
      
      // Group by status
      const byStatus = limited.reduce((acc, todo) => {
        if (!acc[todo.status]) acc[todo.status] = [];
        acc[todo.status].push(todo);
        return acc;
      }, {} as Record<string, TodoItem[]>);
      
      const statusEmojis = {
        in_progress: '🏃',
        pending: '📌',
        completed: '✅',
        cancelled: '❌'
      };
      
      const priorityEmojis = {
        high: '🔴',
        medium: '🟡',
        low: '🟢'
      };
      
      for (const [status, items] of Object.entries(byStatus)) {
        output.push(`\n${statusEmojis[status as keyof typeof statusEmojis]} ${status.toUpperCase()}`);
        output.push('─'.repeat(40));
        
        for (const todo of items) {
          const tags = todo.tags ? ` [${todo.tags.join(', ')}]` : '';
          const project = todo.project ? ` (${todo.project})` : '';
          const due = todo.due ? ` 📅 ${new Date(todo.due).toLocaleDateString()}` : '';
          
          output.push(`${priorityEmojis[todo.priority]} #${todo.id} ${todo.content}${tags}${project}${due}`);
        }
      }
      
      output.push(`\nTotal: ${limited.length} items`);
      
      return {
        content: [{
          type: 'text',
          text: output.join('\n')
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error listing todos: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const todoUpdateTool: Tool = {
  name: 'todo_update',
  description: 'Update a todo item',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Todo ID to update'
      },
      content: {
        type: 'string',
        description: 'New content'
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        description: 'New status'
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'New priority'
      },
      due: {
        type: 'string',
        description: 'New due date (ISO format)'
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'New tags'
      },
      project: {
        type: 'string',
        description: 'New project'
      }
    },
    required: ['id']
  },
  handler: async (args) => {
    try {
      const todos = await loadTodos();
      const index = todos.items.findIndex(t => t.id === args.id);
      
      if (index === -1) {
        return {
          content: [{
            type: 'text',
            text: `Todo #${args.id} not found`
          }],
          isError: true
        };
      }
      
      const todo = todos.items[index];
      
      // Update fields
      if (args.content !== undefined) todo.content = args.content;
      if (args.status !== undefined) todo.status = args.status;
      if (args.priority !== undefined) todo.priority = args.priority;
      if (args.due !== undefined) todo.due = args.due;
      if (args.tags !== undefined) todo.tags = args.tags;
      if (args.project !== undefined) todo.project = args.project;
      
      todo.updated = new Date().toISOString();
      
      await saveTodos(todos);
      
      return {
        content: [{
          type: 'text',
          text: `✅ Updated todo #${todo.id}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error updating todo: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const todoDeleteTool: Tool = {
  name: 'todo_delete',
  description: 'Delete a todo item',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Todo ID to delete'
      }
    },
    required: ['id']
  },
  handler: async (args) => {
    try {
      const todos = await loadTodos();
      const index = todos.items.findIndex(t => t.id === args.id);
      
      if (index === -1) {
        return {
          content: [{
            type: 'text',
            text: `Todo #${args.id} not found`
          }],
          isError: true
        };
      }
      
      const deleted = todos.items.splice(index, 1)[0];
      await saveTodos(todos);
      
      return {
        content: [{
          type: 'text',
          text: `🗑️ Deleted todo #${deleted.id}: ${deleted.content}`
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error deleting todo: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

export const todoStatsTool: Tool = {
  name: 'todo_stats',
  description: 'Show todo statistics',
  inputSchema: {
    type: 'object',
    properties: {
      project: {
        type: 'string',
        description: 'Filter by project'
      },
      period: {
        type: 'string',
        enum: ['all', 'today', 'week', 'month'],
        description: 'Time period',
        default: 'all'
      }
    }
  },
  handler: async (args) => {
    try {
      const todos = await loadTodos();
      let items = todos.items;
      
      // Filter by project
      if (args.project) {
        items = items.filter(t => t.project === args.project);
      }
      
      // Filter by period
      if (args.period && args.period !== 'all') {
        const now = new Date();
        const cutoff = new Date();
        
        switch (args.period) {
          case 'today':
            cutoff.setHours(0, 0, 0, 0);
            break;
          case 'week':
            cutoff.setDate(now.getDate() - 7);
            break;
          case 'month':
            cutoff.setMonth(now.getMonth() - 1);
            break;
        }
        
        items = items.filter(t => new Date(t.created) >= cutoff);
      }
      
      // Calculate stats
      const stats = {
        total: items.length,
        byStatus: {} as Record<string, number>,
        byPriority: {} as Record<string, number>,
        byProject: {} as Record<string, number>,
        overdue: 0,
        completedToday: 0,
        completedThisWeek: 0
      };
      
      const now = new Date();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekAgo = new Date();
      weekAgo.setDate(now.getDate() - 7);
      
      for (const todo of items) {
        // Status counts
        stats.byStatus[todo.status] = (stats.byStatus[todo.status] || 0) + 1;
        
        // Priority counts
        stats.byPriority[todo.priority] = (stats.byPriority[todo.priority] || 0) + 1;
        
        // Project counts
        if (todo.project) {
          stats.byProject[todo.project] = (stats.byProject[todo.project] || 0) + 1;
        }
        
        // Overdue
        if (todo.due && todo.status !== 'completed' && todo.status !== 'cancelled') {
          if (new Date(todo.due) < now) {
            stats.overdue++;
          }
        }
        
        // Completed timing
        if (todo.status === 'completed') {
          const updated = new Date(todo.updated);
          if (updated >= today) stats.completedToday++;
          if (updated >= weekAgo) stats.completedThisWeek++;
        }
      }
      
      // Format output
      const output = ['📊 Todo Statistics'];
      
      if (args.project) {
        output.push(`Project: ${args.project}`);
      }
      if (args.period && args.period !== 'all') {
        output.push(`Period: ${args.period}`);
      }
      
      output.push('');
      output.push(`Total Items: ${stats.total}`);
      
      if (stats.overdue > 0) {
        output.push(`⚠️ Overdue: ${stats.overdue}`);
      }
      
      output.push('\nBy Status:');
      for (const [status, count] of Object.entries(stats.byStatus)) {
        const percent = Math.round((count / stats.total) * 100);
        output.push(`  ${status}: ${count} (${percent}%)`);
      }
      
      output.push('\nBy Priority:');
      for (const [priority, count] of Object.entries(stats.byPriority)) {
        const percent = Math.round((count / stats.total) * 100);
        output.push(`  ${priority}: ${count} (${percent}%)`);
      }
      
      if (Object.keys(stats.byProject).length > 0) {
        output.push('\nBy Project:');
        for (const [project, count] of Object.entries(stats.byProject)) {
          const percent = Math.round((count / stats.total) * 100);
          output.push(`  ${project}: ${count} (${percent}%)`);
        }
      }
      
      output.push('\nRecent Activity:');
      output.push(`  Completed Today: ${stats.completedToday}`);
      output.push(`  Completed This Week: ${stats.completedThisWeek}`);
      
      // Productivity score
      const completionRate = stats.byStatus.completed ? 
        (stats.byStatus.completed / stats.total) * 100 : 0;
      
      output.push('\nProductivity:');
      output.push(`  Completion Rate: ${completionRate.toFixed(1)}%`);
      
      if (completionRate >= 80) {
        output.push('  🌟 Excellent productivity!');
      } else if (completionRate >= 60) {
        output.push('  👍 Good progress!');
      } else if (completionRate >= 40) {
        output.push('  💪 Keep pushing!');
      } else {
        output.push('  🎯 Focus on completing tasks!');
      }
      
      return {
        content: [{
          type: 'text',
          text: output.join('\n')
        }]
      };
    } catch (error: any) {
      return {
        content: [{
          type: 'text',
          text: `Error calculating stats: ${error.message}`
        }],
        isError: true
      };
    }
  }
};

// Export all todo tools
export const todoTools = [
  todoAddTool,
  todoListTool,
  todoUpdateTool,
  todoDeleteTool,
  todoStatsTool
];