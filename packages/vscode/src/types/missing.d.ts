// Temporary type definitions
declare module 'inquirer';
declare module 'uuid';

// Add fetch for Node
declare global {
  const fetch: typeof import('node-fetch').default;
}

export {};
