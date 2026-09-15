FROM node:20-alpine

WORKDIR /src

COPY ./.output /src/.output
# Optional, only needed if you rely on unbundled dependencies
# COPY ./node_modules /src/node_modules

CMD [ "node", ".output/server/index.mjs" ]