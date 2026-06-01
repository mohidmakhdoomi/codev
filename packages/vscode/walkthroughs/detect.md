## Does Codev see your CLI?

The Codev extension drives a command-line tool, `codev` (and its siblings
`afx`, `porch`, `consult`). If that tool isn't installed — or is older than
this extension — Tower can't start and most Codev commands won't work.

Open a terminal and run:

```sh
codev --version
```

- **A version prints** → you're set. Move on to **Verify the installation**.
- **`command not found`** → continue to **Install the Codev CLI**.

The extension checks this automatically on startup and shows a **Codev CLI**
row in the Codev sidebar's **Status** view, with a refresh button to re-check.
