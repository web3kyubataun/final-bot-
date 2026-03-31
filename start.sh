#!/bin/bash
cd "$(dirname "$0")"
exec node --enable-source-maps src/index.js
