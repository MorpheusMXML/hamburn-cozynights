#!/bin/bash
# scripts/decrypt_data.sh

# Ensure we are in the project root
cd "$(dirname "$0")/.."

# Decrypt and extract the pb_data folder
gpg -d hamburn-cozynights/pb_data.tar.gz.gpg | tar -xz

echo "Sensitive data decrypted and extracted to hamburn-cozynights/pb_data/"
