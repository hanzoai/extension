import * as vscode from 'vscode';

export const fsWrapper = {
    readFile: async (uri: vscode.Uri): Promise<Uint8Array> => {
        return vscode.workspace.fs.readFile(uri);
    },
    
    stat: async (uri: vscode.Uri): Promise<vscode.FileStat> => {
        return vscode.workspace.fs.stat(uri);
    },
    
    readDirectory: async (uri: vscode.Uri): Promise<[string, vscode.FileType][]> => {
        return vscode.workspace.fs.readDirectory(uri);
    }
};