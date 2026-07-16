// Ambient declarations for the webview bundle (browser context, built by esbuild).
// Side-effect CSS imports (e.g. the artifact-canvas default theme) carry no types;
// this lets `tsc` type-check the webview without choking on the stylesheet import.
declare module '*.css';
