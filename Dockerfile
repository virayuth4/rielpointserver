FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

ENV NODE_ENV=production

RUN npm ci --omit=dev

COPY . .

EXPOSE 9000

CMD ["node", "server.js"]