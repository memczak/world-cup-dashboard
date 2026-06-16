#!/bin/bash
# Double-click this to serve the World Cup dashboard locally over http://
# (browsers block fetch() from file://; this fixes that). Close the window to stop.
cd "$(dirname "$0")"
PORT=8000
echo "World Cup 2026 dashboard → http://localhost:$PORT"
echo "  Desktop: http://localhost:$PORT/index.html"
echo "  Mobile : http://localhost:$PORT/mobile.html"
echo "Leave this window open while using the app. Press Ctrl-C or close it to stop."
# open the desktop app once the server is up
( sleep 1; open "http://localhost:$PORT/index.html" ) &
exec python3 -m http.server $PORT
