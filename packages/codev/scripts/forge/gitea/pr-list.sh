#!/bin/sh
# Forge concept: pr-list (Gitea via tea CLI)
#
# Normalize tea's PR shape to the GitHub-compatible shape codev expects
# (see PrListItem in codev/src/lib/forge-contracts.ts):
#   index            -> number (int)
#   description      -> body
#   created          -> createdAt
#   author (string)  -> author.login
#   reviewDecision   -> ""  (Gitea has no GitHub-equivalent review-decision summary)
exec tea pulls list --limit 200 \
  --fields index,title,state,author,url,created,description \
  --output json \
  | jq '[.[] | {
      number: (.index | tonumber),
      title,
      state,
      url,
      reviewDecision: "",
      body: (.description // ""),
      createdAt: .created,
      author: {login: .author}
    }]'
