#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

build_package() {
  local package_name="$1"
  local source_dir="$script_dir/$package_name"
  local package_path="$script_dir/$package_name.zip"
  local build_dir

  build_dir="$(mktemp -d "${TMPDIR:-/tmp}/happy-holiday-icon-${package_name}.XXXXXX")"
  trap 'rm -rf "$build_dir"' RETURN

  cp "$source_dir"/*.mjs "$script_dir/retry-policy.mjs" "$source_dir/package.json" "$source_dir/package-lock.json" "$build_dir/"
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
}

build_package "image-reshaper"
build_package "image-generator"
build_package "image-generation-recovery"
