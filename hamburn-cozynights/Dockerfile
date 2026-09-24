# Build context is the repository root (docker-compose.staging.yml: "context: .."),
# because the image also contains the documentation site from ../docs.
FROM node:22-alpine AS build
WORKDIR /app
COPY hamburn-cozynights/package*.json ./
RUN npm ci
COPY hamburn-cozynights/ .
# The commit the image is built from, shown by the version badge and
# /api/health (build-info.ts). The deploy script passes it; a build without
# it shows the version alone.
ARG GIT_SHA=
ENV GIT_SHA=$GIT_SHA
RUN npm run build

# The documentation (VitePress), built once per audience: the guest guide for
# /docs and the full site for /admin/docs. See docs/develop/docs.md.
FROM node:22-alpine AS docs
WORKDIR /docs
# No file is needed from the app build; this only makes the docs wait for it.
# Both builds at once would need more memory than a small server has to spare.
COPY --from=build /app/package.json /tmp/app-build-done
COPY docs/package*.json ./
RUN npm ci
COPY docs/ .
RUN npm run build:app

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Request bodies up to 2 MB (adapter-node's default is 512 KB): layout
# templates may be 1 MB, a ticket list sends up to 5000 rows. nginx allows 10 MB.
ENV BODY_SIZE_LIMIT=2M
ENV DOCS_DIR=/app/docs-dist
COPY hamburn-cozynights/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
COPY --from=docs /docs/.vitepress/dist/app ./docs-dist

EXPOSE 3000
CMD ["node", "build"]
