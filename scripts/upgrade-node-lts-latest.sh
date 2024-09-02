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

# Alias default Node.js version to the latest LTS version
nvm alias default $(nvm current)

# Check if a Docker image tag exists for a given Node.js version
check_docker_image_current_tag() {
  current_tag=$1
  curl --silent -f -lSL https://hub.docker.com/v2/repositories/library/node/tags/$current_tag >/dev/null
}

# Update Dockerfiles with the new Node.js version if the flag is set
if [ "$update_dockerfiles" = true ]; then
  image=node
  current_tag=$(tr -d 'v' <.nvmrc)-slim
  old_tag=${oldver#v}-slim

  if check_docker_image_current_tag $current_tag; then
    # Replace the old Node.js image tag with the new one in Dockerfile
    for file in ./*Dockerfile; do
      # Check if the Dockerfile contains a Node.js image tag that is different from the current one
      if grep -q "$image:" "$file" && ! grep -q "$image:$current_tag" "$file"; then
        sed -i "" "s/$image:[^ ]*/$image:$current_tag/g" "$file"
        echo "Updated $file with Node.js version $current_tag"
      fi
    done
  else
    echo "Docker image tag for Node.js $current_tag does not exist"
  fi
else
  echo "Skipping update of Dockerfiles."
fi

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
