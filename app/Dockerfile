
FROM node:12-alpine
#RUN apk add --no-cache make gcc g++ python
RUN rm -rf /usr/src/pixi/web/uploads
RUN mkdir -p /usr/src/pixi/web
WORKDIR /usr/src/pixi/web
COPY . /usr/src/pixi/web

RUN npm ci
ENV MONGO_URL=mongodb://pixidb:27017/Pixidb
EXPOSE 8090

CMD ["node", "/usr/src/pixi/web/api-server.js"]