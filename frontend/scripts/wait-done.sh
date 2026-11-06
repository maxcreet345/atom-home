#!/bin/bash
# Blocks up to nine minutes (the longest a single tool call may last) for a file to appear, then prints it or says to call again.
# usage: wait-done.sh <file>
end=$(( $(date +%s) + 540 )); while [ ! -f "$1" ] && [ "$(date +%s)" -lt "$end" ]; do perl -e 'select(undef,undef,undef,5)'; done
if [ -f "$1" ]; then cat "$1"; else echo "NOT YET: call this again"; fi
