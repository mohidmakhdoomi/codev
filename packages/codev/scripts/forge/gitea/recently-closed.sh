#!/bin/sh
# Forge concept: recently-closed (Gitea via tea CLI)
#
# Normalize to GitHub-compatible shape (see IssueListItem in forge-contracts.ts).
# Gitea exposes no separate `closed_at` field on issue list output, so we map
# `updated` -> `closedAt`. For issues closed without subsequent edits this is
# exactly the close time; for issues edited after close it overestimates, which
# is acceptable for the "recently closed" overview filter.
exec tea issues list --state closed --limit 1000 \
  --fields index,title,state,author,url,created,updated,labels \
  --output json \
  | jq '[.[] | {
      number: (.index | tonumber),
      title,
      state,
      url,
      createdAt: .created,
      closedAt: .updated,
      labels: (if (.labels // "") == "" then []
               else (.labels | split(",") | map({name: ltrimstr(" ")})) end)
    }]'
