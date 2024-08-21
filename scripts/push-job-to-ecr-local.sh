#!/bin/bash -e

set -e

FORCE_BUILD=false
PUSH_TO_AWS=false
AWS_LOGGED_IN=false
AWS_ENV_FILE_PATH=$(dirname "$0")/.env
CUSTOM_LABEL="local"

# Parse options for --force
for arg in "$@"; do
    case $arg in
    -f | --force)
        FORCE_BUILD=true
        shift # Remove --force from processing
        ;;
    -aws | --push-to-aws)
        PUSH_TO_AWS=true
        shift # Remove --push-to-aws from processing
        ;;
    -l | --label)
        if [ -z "$2" ]; then
            echo "No label value provided"
            exit 1
        fi
        CUSTOM_LABEL="$2"
        shift # Remove --label from processing
        shift # Remove the label value from processing
        ;;
    *)
        # Ignore other arguments
        ;;
    esac
done

# Load environment variables from the .env file only if PUSH_TO_AWS is true
if [ "$PUSH_TO_AWS" = "true" ]; then
    echo "Loading $AWS_ENV_FILE_PATH file"
    if [ -f $AWS_ENV_FILE_PATH ]; then
        export $(grep -v '^#' $AWS_ENV_FILE_PATH | xargs -0)
    else
        echo "No $AWS_ENV_FILE_PATH file found"
        exit 1
    fi
fi

# If PUSH_TO_AWS is true and either AWS_REGION or AWS_SERVER is empty, exit
if [ "$PUSH_TO_AWS" = "true" ]; then
    if [ -z "$AWS_REGION" ] || [ -z "$AWS_SERVER" ]; then
        echo "AWS_REGION or AWS_SERVER is empty"
        exit 1
    else
        echo "AWS_REGION and AWS_SERVER are set"
        AWS_LOGGED_IN=$(aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_SERVER)
    fi
fi

check_changes() {
    local app_dir=$1
    local dockerfile_path=$2

    # Skip check if force build is enabled
    if [ "$FORCE_BUILD" = "true" ]; then
        echo "Force build enabled, skipping change detection."
        return 0 # Pretend changes exist
    fi

    # Fetch the latest from master
    git fetch origin main

    # Check both staged and unstaged changes in the specified directory or Dockerfile
    if git diff --quiet origin/main -- "$app_dir" "$dockerfile_path" && git diff --cached --quiet -- "$app_dir" "$dockerfile_path"; then
        echo "No changes in $app_dir or $dockerfile_path"
        return 1 # No changes exist
    else
        echo "Changes detected in $app_dir or $dockerfile_path"
        return 0 # Changes exist
    fi
}

call_app_push() {
    local app_name=$1
    local app_path=$2
    local dockerfile_path=$3

    # Determine the image name based on whether AWS_SERVER is set
    if [ -n "$AWS_SERVER" ]; then
        local image_name="$AWS_SERVER/$app_name:$CUSTOM_LABEL"
    else
        local image_name="$app_name:$CUSTOM_LABEL"
    fi

    if check_changes "$app_path" "$dockerfile_path" || [ "$FORCE_BUILD" = "true" ]; then
        docker build -t $image_name -f $dockerfile_path .
        if $PUSH_TO_AWS = "true"; then
            docker push $image_name
        fi
    fi
}

call_app_push "argocd-watcher-notifier" "./" "Dockerfile"
