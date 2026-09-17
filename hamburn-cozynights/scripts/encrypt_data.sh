#!/bin/bash
# scripts/encrypt_data.sh

# Ensure we are in the project root (where pb_data is located)
cd "$(dirname "$0")/.."

# Compress and encrypt the pb_data folder
# Note: You will be prompted for a passphrase
tar -cz pb_data | gpg -c -o pb_data.tar.gz.gpg

echo "Sensitive data encrypted to $(pwd)/pb_data.tar.gz.gpg"
echo "Do NOT commit it (public repo). Share it privately, e.g. as a Vaultwarden attachment."
