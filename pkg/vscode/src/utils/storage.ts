import * as vscode from 'vscode';

/**
 * Utility class for handling VS Code storage operations
 */
export class StorageUtil {
    /**
     * Store data in global state
     */
    static async storeGlobal<T>(
        context: vscode.ExtensionContext,
        key: string,
        data: T
    ): Promise<void> {
        try {
            const serialized = JSON.stringify(data);
            await context.globalState.update(key, serialized);
        } catch (error) {
            console.error(`[StorageUtil] Failed to store data for key ${key}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve data from global state
     */
    static async retrieveGlobal<T>(
        context: vscode.ExtensionContext,
        key: string,
        defaultValue: T
    ): Promise<T> {
        try {
            const stored = context.globalState.get<string>(key);
            if (!stored) return defaultValue;
            
            return JSON.parse(stored) as T;
        } catch (error) {
            console.error(`[StorageUtil] Failed to retrieve data for key ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Store data in workspace state
     */
    static async storeWorkspace<T>(
        context: vscode.ExtensionContext,
        key: string,
        data: T
    ): Promise<void> {
        try {
            const serialized = JSON.stringify(data);
            await context.workspaceState.update(key, serialized);
        } catch (error) {
            console.error(`[StorageUtil] Failed to store workspace data for key ${key}:`, error);
            throw error;
        }
    }

    /**
     * Retrieve data from workspace state
     */
    static async retrieveWorkspace<T>(
        context: vscode.ExtensionContext,
        key: string,
        defaultValue: T
    ): Promise<T> {
        try {
            const stored = context.workspaceState.get<string>(key);
            if (!stored) return defaultValue;
            
            return JSON.parse(stored) as T;
        } catch (error) {
            console.error(`[StorageUtil] Failed to retrieve workspace data for key ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Clear data from global state
     */
    static async clearGlobal(
        context: vscode.ExtensionContext,
        key: string
    ): Promise<void> {
        await context.globalState.update(key, undefined);
    }

    /**
     * Clear data from workspace state
     */
    static async clearWorkspace(
        context: vscode.ExtensionContext,
        key: string
    ): Promise<void> {
        await context.workspaceState.update(key, undefined);
    }

    /**
     * Get all keys in global state
     */
    static getGlobalKeys(context: vscode.ExtensionContext): readonly string[] {
        return context.globalState.keys();
    }

    /**
     * Get all keys in workspace state
     */
    static getWorkspaceKeys(context: vscode.ExtensionContext): readonly string[] {
        return context.workspaceState.keys();
    }
}