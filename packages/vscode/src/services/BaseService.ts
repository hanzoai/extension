import * as vscode from 'vscode';

/**
 * Base class for singleton services
 * Provides common singleton pattern implementation
 */
export abstract class BaseService {
    protected context: vscode.ExtensionContext;
    private static instances: Map<string, BaseService> = new Map();

    protected constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get singleton instance of the service
     * @param ServiceClass The service class constructor
     * @param context VS Code extension context
     * @returns The singleton instance
     */
    protected static getSingletonInstance<T extends BaseService>(
        ServiceClass: new (context: vscode.ExtensionContext) => T,
        context: vscode.ExtensionContext
    ): T {
        const className = ServiceClass.name;
        
        if (!this.instances.has(className)) {
            this.instances.set(className, new ServiceClass(context));
        }
        
        return this.instances.get(className) as T;
    }

    /**
     * Store data in global state with error handling
     */
    protected async storeData<T>(key: string, data: T): Promise<void> {
        try {
            const serialized = JSON.stringify(data);
            await this.context.globalState.update(key, serialized);
        } catch (error) {
            this.handleError(`Failed to store data for key ${key}`, error);
        }
    }

    /**
     * Retrieve data from global state with error handling
     */
    protected async retrieveData<T>(key: string, defaultValue: T): Promise<T> {
        try {
            const stored = this.context.globalState.get<string>(key);
            if (!stored) return defaultValue;
            
            return JSON.parse(stored) as T;
        } catch (error) {
            this.handleError(`Failed to retrieve data for key ${key}`, error);
            return defaultValue;
        }
    }

    /**
     * Common error handling
     */
    protected handleError(message: string, error: any): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[${this.constructor.name}] ${message}:`, errorMessage);
        
        // Optionally show error to user based on severity
        if (this.shouldShowErrorToUser(error)) {
            vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
        }
    }

    /**
     * Determine if error should be shown to user
     * Override in subclasses for custom logic
     */
    protected shouldShowErrorToUser(error: any): boolean {
        // By default, don't show errors to user
        return false;
    }

    /**
     * Log info message
     */
    protected log(message: string, ...args: any[]): void {
        console.log(`[${this.constructor.name}] ${message}`, ...args);
    }

    /**
     * Log warning message
     */
    protected warn(message: string, ...args: any[]): void {
        console.warn(`[${this.constructor.name}] ${message}`, ...args);
    }

    /**
     * Dispose of resources
     * Override in subclasses to clean up resources
     */
    public dispose(): void {
        // Base implementation - override in subclasses
    }
}