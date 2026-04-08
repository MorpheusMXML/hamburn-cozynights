#!/bin/bash
# scripts/encrypt_data.sh

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# Compress and encrypt the pb_data folder
# Note: You will be prompted for a passphrase
tar -cz hamburn-cozynights/pb_data | gpg -c -o hamburn-cozynights/pb_data.tar.gz.gpg

echo "Sensitive data encrypted to hamburn-cozynights/pb_data.tar.gz.gpg"
echo "Remember: The physical pb_data folder is ignored by git, but the encrypted .gpg file is not (yet)."
