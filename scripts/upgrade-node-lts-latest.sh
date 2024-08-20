#!/bin/bash -e

set -e
source $(brew --prefix nvm)/nvm.sh # Load nvm from Homebrew installation. Fixes "nvm: command not found" error.

# Display help information
display_help() {
  echo "Update Node.js Version Script"
  echo
  echo "This script updates the Node.js version to the latest LTS release."
  echo "It also provides options to uninstall the previous version and update Dockerfiles."
  echo
  echo "Usage: $0 [OPTIONS]"
  echo
  echo "Options:"
  echo "  -u, --uninstall-previous    Uninstall the previous Node.js version"
  echo "  -d, --update-dockerfiles    Update Dockerfiles with the new Node.js version"
  echo "  -h, --help                  Display this help message"
  echo
}

# Parse command-line options
while [[ "$#" -gt 0 ]]; do
  case $1 in
  -u | --uninstall-previous) uninstall_previous=true ;;
  -d | --update-dockerfiles) update_dockerfiles=true ;;
  -h | --help)
    display_help
    exit 0
    ;;
  *)
    echo "Unknown option: $1"
    display_help
    exit 1
    ;;
  esac
  shift
done

# Get the current Node.js version from .nvmrc
oldver=$(cat .nvmrc)

# Install the latest LTS version of Node.js
nvm install --lts
nvm current >.nvmrc

# Use the newly installed Node.js version
nvm use

# Prompt to uninstall the previous Node.js version if the flag is not set
if [ "$uninstall_previous" != true ]; then
  count_down=5
  answer="N [default]"

  # Display the initial prompt
  echo -n "Do you want to uninstall the previous Node.js version? [y/N]: "

  # Start the countdown loop
  for ((i = $count_down; i > 0; i--)); do
    printf "\rDo you want to uninstall the previous Node.js version? ($i seconds to automatically skip) [y/N]: "
    read -s -n 1 -t 1 answer && break
    # if [ $? -eq 0 ]; then
    #   break
    # fi
  done

  # Move to a new line after the countdown
  echo $answer

  # Handle the user's answer
  case $(echo "$answer" | tr '[:upper:]' '[:lower:]') in
  y)
    nvm uninstall $oldver
    echo "Uninstalled previous Node.js version $oldver"
    ;;
  *)
    echo "Skipping uninstallation of the previous Node.js version."
    ;;
  esac
fi
