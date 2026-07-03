import * as vscode from 'vscode';
import { MCPTool } from '../server';
import * as fs from 'fs';
import * as path from 'path';

interface NotebookCell {
    cell_type: string;
    source: string[];
    outputs?: any[];
    metadata?: any;
    id?: string;
}

interface NotebookData {
    cells: NotebookCell[];
    metadata?: any;
    nbformat?: number;
    nbformat_minor?: number;
}

function resolvePath(p: string): string {
    if (path.isAbsolute(p)) {return p;}
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return ws ? path.resolve(ws, p) : path.resolve(p);
}

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
                const filePath = resolvePath(args.path);
                if (!fs.existsSync(filePath)) {
                    return `Error: Notebook not found: ${filePath}`;
                }
                const raw = fs.readFileSync(filePath, 'utf-8');
                const nb: NotebookData = JSON.parse(raw);

                if (args.cellId) {
                    const idx = parseInt(args.cellId, 10);
                    const cell = !isNaN(idx) ? nb.cells[idx] : nb.cells.find(c => c.id === args.cellId);
                    if (!cell) {return `Error: Cell not found: ${args.cellId}`;}
                    const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
                    const out = (cell.outputs || []).map((o: any) => {
                        if (o.text) {return (Array.isArray(o.text) ? o.text.join('') : o.text);}
                        if (o.data?.['text/plain']) {return (Array.isArray(o.data['text/plain']) ? o.data['text/plain'].join('') : o.data['text/plain']);}
                        return '';
                    }).filter(Boolean).join('\n');
                    return `[${cell.cell_type}] Cell ${args.cellId}:\n${src}${out ? `\n--- Output ---\n${out}` : ''}`;
                }

                const lines: string[] = [`Notebook: ${args.path} (${nb.cells.length} cells, nbformat ${nb.nbformat})`];
                nb.cells.forEach((cell, i) => {
                    const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source;
                    const preview = src.length > 200 ? src.slice(0, 200) + '...' : src;
                    const outCount = (cell.outputs || []).length;
                    lines.push(`\n[${i}] ${cell.cell_type}${outCount ? ` (${outCount} outputs)` : ''}:\n${preview}`);
                });
                return lines.join('\n');
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
                        description: 'Cell index or ID to edit'
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
                const filePath = resolvePath(args.path);
                if (!fs.existsSync(filePath)) {
                    return `Error: Notebook not found: ${filePath}`;
                }
                const raw = fs.readFileSync(filePath, 'utf-8');
                const nb: NotebookData = JSON.parse(raw);
                const idx = parseInt(args.cellId, 10);
                const cellIndex = !isNaN(idx) ? idx : nb.cells.findIndex(c => c.id === args.cellId);

                if (cellIndex < 0 || cellIndex >= nb.cells.length) {
                    return `Error: Cell not found: ${args.cellId} (notebook has ${nb.cells.length} cells)`;
                }

                const cell = nb.cells[cellIndex];
                cell.source = args.content.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line);
                if (args.cellType) {cell.cell_type = args.cellType;}
                cell.outputs = [];

                fs.writeFileSync(filePath, JSON.stringify(nb, null, 1) + '\n', 'utf-8');
                return `Updated cell ${cellIndex} in ${args.path} (${cell.cell_type}, ${cell.source.length} lines)`;
            }
        }
    ];
}
