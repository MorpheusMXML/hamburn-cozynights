#!/bin/bash
# scripts/encrypt_data.sh

# Ensure we are in the project root (where pb_data is located)
cd "$(dirname "$0")/.."

# Compress and encrypt the pb_data folder
# Note: You will be prompted for a passphrase
tar -cz pb_data | gpg -c -o pb_data.tar.gz.gpg

echo "Sensitive data encrypted to $(pwd)/pb_data.tar.gz.gpg"
echo "Remember: The physical pb_data folder is ignored by git, but the encrypted .gpg file is not (yet)."
