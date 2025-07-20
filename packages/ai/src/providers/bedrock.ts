export const bedrock = (config: any) => ({ name: 'bedrock', async complete(p: any) { return { content: '' }; }, async *stream(p: any) { yield { type: 'done' as const }; } });
