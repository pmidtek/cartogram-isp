FROM node:20-alpine
RUN corepack enable
RUN corepack prepare pnpm@8.14.0 --activate

COPY ./dist/spreet-v0.11.0.tar.gz /tmp/spreet.tar.gz
RUN tar -xzf /tmp/spreet.tar.gz -C /tmp \
    && mv /tmp/spreet /usr/local/bin/spreet \
    && chmod +x /usr/local/bin/spreet \
    && rm /tmp/spreet.tar.gz

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY ./ ./
CMD [ "pnpm", "start" ]
