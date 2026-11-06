#!/bin/bash
# One round's long work, independent of whoever started it: the card's gate, the preview build, then every connected real device at the same time.
# Writes <evidence>/gate.out, <evidence>/<id>.log, and <evidence>/DONE last, with one line per result. Start it detached; wait with wait-done.sh.
# usage: card-round.sh <card> <gate script> <gate round> <evidence dir> <id:serial:port>...
card=$1; gate=$2; round=$3; ev=$4; shift 4; cd "$(dirname "$0")/.." || exit 1; mkdir -p "$ev"; rm -f "$ev/DONE"; out="$ev/DONE.tmp"; : > "$out"
"$gate" "$round" > "$ev/gate.out" 2>&1; rc=$?
if [ $rc -ne 0 ] || grep -qE '^✘|ℹ fail [1-9]|FAILED|error TS|[1-9][0-9]* failed' "$ev/gate.out"; then echo "gate: FAILED, see $ev/gate.out" >> "$out"; mv "$out" "$ev/DONE"; exit 0; fi
echo "gate: clean" >> "$out"
npm run -s preview:build > "$ev/build.out" 2>&1; rc=$?; echo "preview build: exit $rc" >> "$out"; [ $rc -eq 0 ] || { mv "$out" "$ev/DONE"; exit 0; }
pkill -f "[s]cripts/card-preview.mjs" ; sleep 1; nohup node scripts/card-preview.mjs 4173 > "$ev/preview.log" 2>&1 & # the server keeps the scenarios it loaded: a new scenario would never open, and so would stop the device runs
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null --max-time 1 http://127.0.0.1:4173/ && break; sleep 1; done
pids=""; for d in "$@"; do IFS=: read -r id serial port <<< "$d"; if [ "$(adb -s "$serial" get-state 2>/dev/null)" = device ]; then perl -e 'alarm 2400; exec @ARGV' node scripts/device-audit.mjs "$serial" "$card" "$ev/$id" "$port" > "$ev/$id.log" 2>&1 & pids="$pids $id:$!"; else echo "$id: not connected" >> "$out"; fi; done # a device that is not here is written down and checked later: nobody waits for it (owner, 06.11.2026)
for p in $pids; do id=${p%%:*}; wait "${p##*:}"; rc=$?; echo "$id: exit $rc $(tail -1 "$ev/$id.log" | cut -c1-700)" >> "$out"; done
mv "$out" "$ev/DONE"
