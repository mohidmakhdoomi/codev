# Spike: Expo scaffold + LAN Tower reachability

**Date**: 2026-07-16
**Status**: Headless phase complete (green). Device phase pending (requires a physical phone + a BRIDGE_MODE Tower; procedure below).
**Executed by**: mobile architect directly at Amr's instruction (deviation from the spike-as-EXPERIMENT-builder default, recorded per protocol).
**Spike code**: discarded per policy (scaffold lived in a session scratchpad). The recipe and key source below are the deliverable; the real `apps/mobile` starts fresh through PIR gates.

## Question this spike answers

Can an Expo / React Native app on a phone (1) fetch Tower's REST surface and (2) hold the `/ws/messages` WebSocket, over LAN, with a config a PIR builder can copy verbatim?

## Verdict

Everything verifiable without a physical device is green:

- TypeScript strict check passes; Metro produces a 1.4MB Hermes iOS bundle (451 modules) via `npx expo export`.
- Tower's global `GET /api/overview` requires no parameters (HTTP 200 with cross-workspace builders); `GET /health`, `GET /api/version`, and the workspace-scoped overview route all respond as documented.
- RN's built-in `WebSocket` covers `/ws/messages` (no library needed). RN has **no `EventSource`**, so Tower's SSE channel is unavailable on mobile as-is: the mobile client uses WS + polling, or Tower grows a WS equivalent of the SSE refetch ticks (a small item to fold into the structured-events design, interaction-model §8).
- `AppState` replaces the browser's `visibilitychange` for the reconnect-on-foreground seam; iOS suspends sockets in background, so foreground-reconnect is mandatory, not optional.
- The `baseUrl` must be explicit user-supplied config (no `window.location` on RN): the exact seam issue #1189's codev-sdk formalizes.

## Recipe (exact versions, 2026-07-16)

```bash
npx create-expo-app@latest codev-mobile --template blank-typescript
```

Resulting versions: Expo SDK `~57.0.6`, React Native `0.86.0`, React `19.2.3`, TypeScript `~6.0.3`. Toolchain: Node 22.19.0, pnpm 10.33.0, watchman + Xcode present.

### app.json — the LAN-access block (the part that is easy to get wrong)

```json
"ios": {
  "infoPlist": {
    "NSLocalNetworkUsageDescription": "Codev connects to your Tower server on the local network to show builder status and messages.",
    "NSAppTransportSecurity": { "NSAllowsLocalNetworking": true }
  }
},
"android": {
  "usesCleartextTraffic": true
}
```

Three settings, three different failure modes if missing:

1. **`NSLocalNetworkUsageDescription` (iOS)**: required for the iOS 14+ local-network permission prompt. Without it, a release/dev-client build crashes or silently fails on first LAN access.
2. **`NSAppTransportSecurity.NSAllowsLocalNetworking` (iOS)**: ATS blocks cleartext `http://` by default; this scoped exception permits it for local hosts without the blanket `NSAllowsArbitraryLoads`.
3. **`usesCleartextTraffic` (Android)**: Android 9+ blocks cleartext by default; `http://<lan-ip>:4100` needs this (or a narrower networkSecurityConfig later).

**Expo Go nuance**: `infoPlist` keys only land in *built* binaries (`npx expo run:ios`, dev-client, EAS). Expo Go ignores them and relies on its own already-granted local-network entitlement, which is why quick Expo Go testing works before any of this is configured, and why a first dev-client build "mysteriously" breaks without these keys. Configure them from day one.

## The codev-core Metro experiment (evidence for #1189)

Installed `@cluesmith/codev-core@3.2.3` from a tarball into the spike app and bundled twice:

- `import { EscapeBuffer } from '@cluesmith/codev-core/escape-buffer'` → **bundles clean** (pure leaf).
- `import { DEFAULT_TOWER_PORT } from '@cluesmith/codev-core/constants'` → **Metro fails**: `Unable to resolve module node:path ... dist/constants.js`. `DEFAULT_TOWER_PORT = 4100` sits on line 3, one line below the `node:path`/`node:os` imports that kill the bundle.

This empirically confirms issue #1189's two claims: core's pure leaves are RN-consumable today, and the `constants` module traps pure values behind Node builtins. The failure is loud (bundle-time), not a silent runtime break.

## Device-verification procedure (remaining half, needs Amr)

1. **Tower on the LAN**: restart Tower with `BRIDGE_MODE=1` so it binds beyond localhost. ⚠️ A Tower restart kills live builder PTYs and any dev PTY: coordinate timing with main, do it between builder sessions.
2. In the scaffold: `npx expo start`, open in Expo Go on a phone on the same Wi-Fi.
3. Enter `http://<laptop-lan-ip>:4100`, tap **Probe REST**: expect health/version/builder list + latency reading.
4. Tap **Connect WS**, then from the laptop run any `afx send`: the frame should appear in the message-bus list within ~a second.
5. For the permission-prompt validation specifically, use a dev build (`npx expo run:ios`), not Expo Go, and confirm the local-network prompt shows the `NSLocalNetworkUsageDescription` text.
6. Background the app 30s, foreground it: WS should reconnect via the `AppState` handler.

## What this de-risks for the PoC

- The scaffold + LAN config recipe is copy-paste ready for the real `apps/mobile` (which now has a home: #855 merged, `apps/` exists).
- The client seam list for codev-sdk (#1189) is validated from the consuming side: explicit `baseUrl`, injected storage, WS-not-SSE, `AppState` lifecycle.
- No third-party networking libraries needed for v0 transport.

## Appendix: spike client source (App.tsx, 187 lines)

Kept for reference; wire types were inlined to keep the spike dependency-free (the real app imports `@cluesmith/codev-types`).

```tsx
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';

type OverviewBuilder = {
  issueId?: number; issueTitle?: string; phase?: string; blocked?: boolean;
};
type MessageFrame = {
  type: 'message'; timestamp: string;
  from: { project?: string; agent?: string };
  to: { project?: string; agent?: string };
  content: string;
};
type ConnState = 'idle' | 'connecting' | 'open' | 'error' | 'closed';

export default function App() {
  const [baseUrl, setBaseUrl] = useState('http://192.168.1.10:4100');
  const [health, setHealth] = useState<string>('-');
  const [version, setVersion] = useState<string>('-');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [builders, setBuilders] = useState<OverviewBuilder[]>([]);
  const [wsState, setWsState] = useState<ConnState>('idle');
  const [frames, setFrames] = useState<MessageFrame[]>([]);
  const [error, setError] = useState<string>('');
  const wsRef = useRef<WebSocket | null>(null);

  const probe = useCallback(async () => {
    setError('');
    try {
      const t0 = Date.now();
      const h = await fetch(`${baseUrl}/health`);
      setLatencyMs(Date.now() - t0);
      setHealth(h.ok ? (await h.json()).status : `HTTP ${h.status}`);
      const v = await fetch(`${baseUrl}/api/version`);
      if (v.ok) setVersion((await v.json()).version);
      const o = await fetch(`${baseUrl}/api/overview`);
      if (o.ok) setBuilders((await o.json()).builders ?? []);
    } catch (e) {
      setError(String(e));
      setHealth('-');
      setLatencyMs(null);
    }
  }, [baseUrl]);

  const connectWs = useCallback(() => {
    wsRef.current?.close();
    setWsState('connecting');
    const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws/messages`);
    ws.onopen = () => setWsState('open');
    ws.onerror = () => setWsState('error');
    ws.onclose = () => setWsState('closed');
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(String(ev.data));
        if (frame.type === 'message') setFrames((p) => [frame, ...p].slice(0, 20));
      } catch { /* non-JSON frame: ignore */ }
    };
    wsRef.current = ws;
  }, [baseUrl]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && wsRef.current?.readyState !== WebSocket.OPEN) {
        connectWs();
        probe();
      }
    });
    return () => sub.remove();
  }, [connectWs, probe]);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>Codev Tower LAN spike</Text>
      <TextInput
        style={styles.input} value={baseUrl} onChangeText={setBaseUrl}
        autoCapitalize="none" autoCorrect={false}
        placeholder="http://<tower-lan-ip>:4100" placeholderTextColor="#666"
      />
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={probe}>
          <Text style={styles.buttonText}>Probe REST</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={connectWs}>
          <Text style={styles.buttonText}>Connect WS</Text>
        </Pressable>
      </View>
      <Text style={styles.stat}>
        health: {health}  version: {version}
        {latencyMs !== null ? `  ${latencyMs}ms` : ''}
      </Text>
      <Text style={styles.stat}>ws: {wsState}  frames: {frames.length}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.section}>Builders ({builders.length})</Text>
      <FlatList
        data={builders}
        keyExtractor={(b, i) => `${b.issueId ?? i}`}
        renderItem={({ item }) => (
          <Text style={styles.rowText}>
            #{item.issueId} {item.phase ?? '?'}
            {item.blocked ? ' [blocked]' : ''} {item.issueTitle ?? ''}
          </Text>
        )}
      />
      <Text style={styles.section}>Message bus (latest {frames.length})</Text>
      <FlatList
        data={frames}
        keyExtractor={(f, i) => `${f.timestamp}-${i}`}
        renderItem={({ item }) => (
          <Text style={styles.rowText}>
            {item.from.agent ?? '?'} → {item.to.agent ?? '?'}: {item.content}
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117', paddingTop: 64, paddingHorizontal: 16 },
  title: { color: '#e6edf3', fontSize: 20, fontWeight: '600', marginBottom: 12 },
  input: {
    color: '#e6edf3', borderColor: '#30363d', borderWidth: 1, borderRadius: 8,
    padding: 10, fontFamily: 'Menlo', marginBottom: 8,
  },
  row: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  button: { backgroundColor: '#238636', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  buttonText: { color: '#fff', fontWeight: '600' },
  stat: { color: '#8b949e', fontFamily: 'Menlo', fontSize: 12, marginBottom: 4 },
  error: { color: '#f85149', fontSize: 12, marginVertical: 4 },
  section: { color: '#e6edf3', fontWeight: '600', marginTop: 12, marginBottom: 4 },
  rowText: { color: '#8b949e', fontSize: 12, fontFamily: 'Menlo', marginBottom: 2 },
});
```
