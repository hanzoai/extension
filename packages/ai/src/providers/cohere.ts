export const cohere = (config: any) => ({ name: 'cohere', async complete(p: any) { return { content: '' }; }, async *stream(p: any) { yield { type: 'done' as const }; } });
