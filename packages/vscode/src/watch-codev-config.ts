import * as vscode from 'vscode';

/**
 * Fire `onChange` whenever `<workspacePath>/.codev/config.json` or
 * `.codev/config.local.json` is created, changed, or deleted. Returns a
 * single `Disposable` bundling the watcher and its three subscriptions
 * — push it onto `context.subscriptions` so it cleans up on extension
 * deactivate.
 *
 * Mirrors Tower's own config watcher in
 * `packages/codev/src/agent-farm/servers/tower-tunnel.ts:startConfigWatcher`
 * (which watches `~/.codev/cloud.json` via `node:fs.watch`). This is the
 * VSCode-runtime equivalent: `vscode.workspace.createFileSystemWatcher`
 * gives us cross-platform consistency and standard Disposable lifecycle
 * rather than the raw Node API.
 */
export function watchCodevConfig(
  workspacePath: string,
  onChange: () => void,
): vscode.Disposable {
  // Two explicit alternatives. Earlier draft used `.codev/config{,.local}.json`
  // with an empty-string alternative inside the braces, which VSCode's glob
  // matcher inconsistently honors — observed: matched `config.json` only,
  // missed `config.local.json`. Listing both filenames explicitly is
  // unambiguous across glob implementations.
  const pattern = new vscode.RelativePattern(
    workspacePath,
    '.codev/{config.json,config.local.json}',
  );
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  return vscode.Disposable.from(
    watcher,
    watcher.onDidCreate(onChange),
    watcher.onDidChange(onChange),
    watcher.onDidDelete(onChange),
  );
}
