#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$script_dir/image-reshaper"
package_path="$script_dir/image-reshaper.zip"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/happy-holiday-icon-image-reshaper.XXXXXX")"

cleanup() {
  rm -rf "$build_dir"
}

trap cleanup EXIT

cp "$source_dir/index.mjs" "$source_dir/package.json" "$source_dir/package-lock.json" "$build_dir/"
(
  cd "$build_dir"
  npm ci \
    --omit=dev \
    --os=linux \
    --cpu=arm64 \
    --libc=glibc
)

rm -f "$package_path"
(cd "$build_dir" && zip -qr "$package_path" . -x '*.DS_Store')

echo "Created $package_path"
