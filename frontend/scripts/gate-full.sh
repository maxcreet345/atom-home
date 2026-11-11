#!/bin/bash
# One gate for the whole dashboard: types, unit tests, the backend tests that run under the local python3, both builds, then EVERY qa-*.mjs one after
# another (qa-live excluded: it needs the real Home Assistant). The okapi/office checks are inside: tests/office-*.test.ts in `npm test`, the okapi
# scenarios in qa-heating / qa-light / qa-air / qa-security.
# usage: gate-full.sh <output folder> [step ...]
#   step = tsc | test | py | preview | build | <qa script name, with or without «qa-»>; no steps = everything (a full run).
#   A list runs only those steps, in the gate's order (to split a full run over several calls: «tsc test py preview build», then the scripts).
#   GATE_TIMEOUT=<seconds> per qa script (default 1800). GATE_SKIP_BUILD=1 with a list of scripts is implied: builds run only when named.
# Writes <out>/<step>.log, <out>/<qa-name>/ (the script's own screenshots) and <out>/SUMMARY.txt; prints one line per step and, last,
# «GATE: clean» or «GATE: FAILED <names>» (a partial run says «GATE (partial: …)» so that it is never taken for a full one).
out=${1:?usage: gate-full.sh <output folder> [step ...]}; shift
cd "$(dirname "$0")/.." || exit 2
mkdir -p "$out" || exit 2; out=$(cd "$out" && pwd)
limit=${GATE_TIMEOUT:-1800}
all_qa=$(ls scripts/qa-*.mjs | sed -E 's#scripts/(qa-.*)\.mjs#\1#' | grep -v '^qa-live$')
want="$*"; partial=""; [ -n "$want" ] && partial=1
has() { [ -z "$partial" ] && return 0; for w in $want; do [ "$w" = "$1" ] || [ "qa-$w" = "$1" ] && return 0; done; return 1; }
for w in $want; do case "$w" in tsc|test|py|preview|build) ;; *) echo "$all_qa" | grep -qx "qa-${w#qa-}" || { echo "unknown step: $w"; exit 2; } ;; esac; done
sum="$out/SUMMARY.txt"; [ -z "$partial" ] && : > "$sum"; failed=""
say() { echo "$1"; echo "$1" >> "$sum"; }
note() { # name, exit code, failed count
  say "[$1] exit $2, failed $3"; if [ "$2" -ne 0 ] || [ "$3" -ne 0 ]; then failed="$failed $1"; fi; }
count() { n=$(grep -cE '^✘|^✖|"p": false' "$1" 2>/dev/null); echo "${n:-0}"; }

if has tsc; then npx tsc --noEmit > "$out/tsc.log" 2>&1; rc=$?; note tsc $rc "$(grep -c 'error TS' "$out/tsc.log")"; fi
if has test; then npm test > "$out/test.log" 2>&1; rc=$?; n=$(sed -nE 's/^ℹ fail ([0-9]+).*/\1/p' "$out/test.log" | tail -1); note test $rc "${n:-0}"; fi
if has py; then
  : > "$out/py.log"; bad=0; ran=0
  for t in ../tests/components/atom_home/test_*.py; do
    echo "== $t" >> "$out/py.log"; python3 "$t" > "$out/py.one" 2>&1; rc=$?; cat "$out/py.one" >> "$out/py.log"
    # a file that needs the Home Assistant test harness (another Python) does not run here: written down, not counted
    if [ $rc -ne 0 ] && grep -q "No module named 'pytest_homeassistant_custom_component'\|No module named 'homeassistant'" "$out/py.one"; then echo "   skipped: needs the HA test harness" >> "$out/py.log"; continue; fi
    ran=$((ran + 1)); [ $rc -ne 0 ] && bad=$((bad + 1))
  done; rm -f "$out/py.one"; [ $ran -eq 0 ] && bad=1; echo "   ran $ran files" >> "$out/py.log"; note py $bad $bad
fi
if has preview; then npm run -s preview:build > "$out/preview.log" 2>&1; rc=$?; note preview $rc "$(grep -ciE '(^|[^a-z])error' "$out/preview.log")"; fi
if has build; then npm run -s build > "$out/build.log" 2>&1; rc=$?; note build $rc "$(grep -ciE '(^|[^a-z])error' "$out/build.log")"; fi

for q in $all_qa; do
  has "$q" || continue
  log="$out/$q.log"
  # qa-live-updates takes no folder (it reads the tracked bundle); every other script gets its own
  if [ "$q" = qa-live-updates ]; then perl -e 'alarm shift; exec @ARGV' "$limit" node "scripts/$q.mjs" > "$log" 2>&1; rc=$?
  else perl -e 'alarm shift; exec @ARGV' "$limit" node "scripts/$q.mjs" "$out/$q" > "$log" 2>&1; rc=$?; fi
  [ $rc -eq 142 ] && echo "✘ gate: $q did not finish in $limit s" >> "$log"
  note "$q" $rc "$(count "$log")"
done

if [ -n "$partial" ]; then head="GATE (partial: $want):"; else head="GATE:"; fi
if [ -z "$failed" ]; then say "$head clean"; else say "$head FAILED$failed"; exit 1; fi
