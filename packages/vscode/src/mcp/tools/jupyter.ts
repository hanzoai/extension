import * as vscode from 'vscode';
import { MCPTool } from '../server';

export function createJupyterTools(context: vscode.ExtensionContext): MCPTool[] {
    return [
        {
            name: 'notebook_read',
            description: 'Read a Jupyter notebook file',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the notebook file'
                    },
                    cellId: {
                        type: 'string',
                        description: 'Specific cell ID to read (optional)'
                    }
                },
                required: ['path']
            },
            handler: async (args: { path: string; cellId?: string }) => {
                // TODO: Implement Jupyter notebook reading
                return 'Jupyter notebook support coming soon';
            }
        },
        
        {
            name: 'notebook_edit',
            description: 'Edit a Jupyter notebook cell',
            inputSchema: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Path to the notebook file'
                    },
                    cellId: {
                        type: 'string',
                        description: 'Cell ID to edit'
                    },
                    content: {
                        type: 'string',
                        description: 'New content for the cell'
                    },
                    cellType: {
                        type: 'string',
                        enum: ['code', 'markdown'],
                        description: 'Type of cell'
                    }
                },
                required: ['path', 'cellId', 'content']
            },
            handler: async (args: { path: string; cellId: string; content: string; cellType?: string }) => {
                // TODO: Implement Jupyter notebook editing
                return 'Jupyter notebook editing coming soon';
            }
        }
    ];
}