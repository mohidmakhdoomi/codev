import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },

    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // Enforce the #791 command-registrar convention: every VS Code command
        // must register through `reg(...)` (no guard) or `regCli(...)` (CLI-preflight
        // guard) from extension.ts, never a bare `vscode.commands.registerCommand`.
        // A bare call silently bypasses the guard. `error` (not `warn`) so it fails
        // `pnpm lint` / `pnpm compile` / `pnpm package`. Legitimate low-level call
        // sites (the two helper definitions; CLI-independent registrations in
        // separate modules) opt out with `eslint-disable-next-line ... -- <reason>`.
        "no-restricted-syntax": ["error", {
            selector: "CallExpression[callee.object.object.name='vscode'][callee.object.property.name='commands'][callee.property.name='registerCommand']",
            message: "Use reg(...) or regCli(...) from extension.ts instead of bare vscode.commands.registerCommand — regCli adds the CLI-preflight guard (#791). If a registration legitimately can't use the helpers, add an eslint-disable-next-line with a one-line reason.",
        }],
    },
}];