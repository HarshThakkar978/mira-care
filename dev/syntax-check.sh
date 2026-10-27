#!/bin/sh
# Syntax-checks the project's JavaScript with macOS's built-in JavaScriptCore (no Node needed).
# Usage: sh dev/syntax-check.sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
TMP="${TMPDIR:-/tmp}/mira-syntax.js"
status=0
for f in app.js admin.js sw.js api/*.js api/_lib/*.js; do
  # Drop import lines (including multi-line ones) and "export", since checkSyntax reads plain scripts.
  awk 'skip { if ($0 ~ /from /) skip = 0; next } /^import / { if ($0 !~ /from /) skip = 1; next } { sub(/^export /, ""); print }' "$f" > "$TMP"
  if $JSC -e "checkSyntax('$TMP')" >/dev/null 2>&1; then echo "ok   $f"; else echo "FAIL $f"; $JSC -e "checkSyntax('$TMP')"; status=1; fi
done
rm -f "$TMP"
exit $status
