#!/bin/sh
# Körs via cron var 5:e minut. Pullar bara om arbetsträdet är rent,
# så att ej committade ändringar aldrig skrivs över.
set -e
cd /Users/antonmolund/ladchat

if [ -n "$(/usr/bin/git status --porcelain)" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') hoppar över pull: ej committade ändringar finns"
  exit 0
fi

/usr/bin/git pull --ff-only origin main
