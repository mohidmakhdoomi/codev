#!/bin/sh
# Forge concept: recently-merged (Gitea via tea CLI)
#
# `tea pulls list --state closed` returns both merged PRs and closed-without-
# merge PRs. Filter to merged only via `.merged == true` (the same predicate
# scripts/forge/gitea/pr-exists.sh already relies on), then map to the
# GitHub-compatible shape:
#   index           -> number (int)
#   created         -> createdAt
#   updated         -> mergedAt  (tea exposes no merged_at field via --fields;
#                                 close-then-edit overestimates merged time
#                                 but is acceptable for the 24h overview window)
#   head.ref        -> headRefName
#   description     -> body
exec tea pulls list --state closed --limit 1000 \
  --fields index,title,state,author,url,created,updated,head,description,merged \
  --output json \
  | jq '[.[] | select(.merged == true) | {
      number: (.index | tonumber),
      title,
      state,
      url,
      body: (.description // ""),
      createdAt: .created,
      mergedAt: .updated,
      headRefName: (.head.ref // "")
    }]'
