#!/bin/sh
# Syntax-checks the project's JavaScript with macOS's built-in JavaScriptCore (no Node needed).
# Usage: sh dev/syntax-check.sh
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
TMP="${TMPDIR:-/tmp}/mira-syntax.js"
status=0
for f in app.js admin.js sw.js api/*.js api/_lib/*.js; do
  grep -v '^import ' "$f" | sed 's/^export //' > "$TMP"
  if $JSC -e "checkSyntax('$TMP')" >/dev/null 2>&1; then echo "ok   $f"; else echo "FAIL $f"; $JSC -e "checkSyntax('$TMP')"; status=1; fi
done
rm -f "$TMP"
exit $status
