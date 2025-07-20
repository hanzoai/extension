export const mistral = (config: any) => ({ name: 'mistral', async complete(p: any) { return { content: '' }; }, async *stream(p: any) { yield { type: 'done' as const }; } });
