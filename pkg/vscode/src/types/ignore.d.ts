declare module 'ignore' {
    interface IgnoreFilter {
        add(patterns: string | string[]): IgnoreFilter;
        ignores(path: string): boolean;
    }
    
    function ignore(): IgnoreFilter;
    
    export = ignore;
}