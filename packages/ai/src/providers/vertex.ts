export const vertex = (config: any) => ({ name: 'vertex', async complete(p: any) { return { content: '' }; }, async *stream(p: any) { yield { type: 'done' as const }; } });
