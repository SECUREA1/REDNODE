# REDNODE

This repository contains a static HTML page and a simple Docker setup to serve it.

## Dockerfile
The Dockerfile at the project root (`/workspace/REDNODE/Dockerfile`) uses the lightweight `nginx:alpine` image.

## Build and Run
```
docker build -t rednode .
docker run -p 8080:80 rednode
```
Visit `http://localhost:8080` to view the page.
