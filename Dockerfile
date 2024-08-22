FROM node:20.17.0-slim

WORKDIR /usr/src/app

COPY package.json eslint.config.js tsconfig.json .prettierrc.yaml yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn
COPY src ./src

RUN yarn install --immutable
RUN yarn build

ENV NODE_ENV production
ENV LOG_FORMAT json

# USER node
CMD [ "yarn", "start:prod" ]
