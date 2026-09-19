// esbuild bundles a stylesheet import into dist/app.css (build.js), so to
// TypeScript it is a module with nothing in it.
declare module '*.css';
