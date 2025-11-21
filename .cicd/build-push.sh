#!/bin/bash
IMAGE=reimagined-disco-api
TAG=`git describe --tags --abbrev=0`
echo $IMAGE:$TAG

### V1
# docker build -t pirraste/$IMAGE:$TAG -f .docker/Dockerfile .
# docker push pirraste/$IMAGE:$TAG

### V2
# TMPDIR=`mktemp -d`
# pushd $TMPDIR
# docker run -ti --rm \
#   -v $HOME/.docker/kanikoConfig.json:/kaniko/.docker/config.json:ro \
#   gcr.io/kaniko-project/executor:latest \
#     --context=git@github.com:pste/$IMAGE.git \
# 	--dockerfile=/workspace/.docker/Dockerfile \
# 	--destination=pirraste/$IMAGE:$TAG
# popd

### V3
# kubectl apply -f .cicd/k8s-build-api-job.yaml

### V4
# in Host (windows) machine: docker tag + build + push (as in V1)
# use k8s project to deploy all the packages