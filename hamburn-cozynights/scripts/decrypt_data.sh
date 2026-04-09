#!/bin/bash
# scripts/decrypt_data.sh

# Ensure we are in the project root (where pb_data should be)
cd "$(dirname "$0")/.."

# Decrypt and extract the pb_data folder
gpg -d pb_data.tar.gz.gpg | tar -xz

echo "Sensitive data decrypted and extracted to $(pwd)/pb_data/"
